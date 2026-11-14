// フェーズ5.9: アプリの終了（×・⌘Q 相当・SIGINT）と、開発起動（npm run dev）の所有プロセスの後始末のUIシナリオ。run.mjs から呼ぶ。
// - すべて専用の一時userData・専用ポート（開発サーバー・デバッグ）を使い、自分が起動したプロセス（とその子孫）だけを操作する。
// - 開発起動は npm run dev を自分のプロセスグループ（detached）で起動し、Ctrl+C 相当の SIGINT はそのグループにだけ送る。
//   pkill・killall などの一括終了は使わない。無関係なプロセス（別のNode・別のElectron）が残ることも確かめる。
// - electron-vite dev は out/main・out/preload を開発用に作り直すため、最後に本番用のビルドへ戻す（electron-vite build）。
import { execFileSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import {
  assert,
  connectCdp,
  doubleClick,
  freePort,
  keyWith,
  launchApp,
  listeningAddresses,
  PROJECT_ROOT,
  processTree,
  requestQuit,
  sleep,
  TestFailure
} from './lib.mjs'
import { readDb, rowOf, seedDatabase, U } from './scenarios-inbox-ops.mjs'

const BASE = '2026-11-03T00:00:00.000Z'
const DRAFT_MESSAGE = 'タスクのタイトルに未保存の変更があります'

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 指定した文字列を引数に含むプロセス（一時userDataのパスで、この起動のプロセスだけを探す。読み取りのみ）
function processesWith(text) {
  const out = execFileSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' })
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(text))
    .map((line) => ({ pid: Number(line.split(/\s+/)[0]), command: line.slice(0, 160) }))
}

function commandOf(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

// npm run dev を専用のプロセスグループで起動する（hidden・一時userData・専用ポート）
export async function launchDev({ userDataDir, dialogAnswers = [] }) {
  const rendererPort = await freePort()
  const cdpPort = await freePort()
  const env = {
    ...process.env,
    GTD_TEST_UI: 'hidden',
    GTD_DEV_USER_DATA_DIR: userDataDir,
    GTD_DEV_RENDERER_PORT: String(rendererPort),
    REMOTE_DEBUGGING_PORT: String(cdpPort)
  }
  delete env.ELECTRON_RENDERER_URL
  delete env.GTD_TEST_DIALOG_ANSWERS
  if (dialogAnswers.length > 0) env.GTD_TEST_DIALOG_ANSWERS = JSON.stringify(dialogAnswers)
  const child = spawn('npm', ['run', 'dev'], { cwd: PROJECT_ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const logs = []
  const onData = (chunk) => logs.push(...chunk.toString().split('\n').filter(Boolean))
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  let exitInfo = null
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => {
      exitInfo = { code, signal }
      resolve(exitInfo)
    })
  )
  const dev = {
    pgid: child.pid,
    rendererPort,
    cdpPort,
    logs,
    exited,
    get exitInfo() {
      return exitInfo
    },
    waitExit: (ms = 30000) => Promise.race([exited, sleep(ms).then(() => null)]),
    // 自分のプロセスグループにだけシグナルを送る
    signalGroup(signal) {
      try {
        process.kill(-child.pid, signal)
      } catch {
        // 既に終了している
      }
    }
  }
  const deadline = Date.now() + 90000
  for (;;) {
    if (exitInfo !== null) throw new TestFailure(`開発起動が終了しました: ${logs.slice(-20).join('\n')}`)
    try {
      const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(2000) })).json()
      const page = targets.find((target) => target.type === 'page' && target.url.includes(`:${rendererPort}`))
      if (page) {
        dev.cdp = await connectCdp(page.webSocketDebuggerUrl)
        break
      }
    } catch {
      // まだ待ち受けていない
    }
    if (Date.now() > deadline) {
      dev.signalGroup('SIGKILL')
      throw new TestFailure(`開発起動を確認できませんでした: ${logs.slice(-30).join('\n')}`)
    }
    await sleep(300)
  }
  await dev.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await dev.cdp.waitFor(`!!document.querySelector('nav button[aria-label="Inbox"]')`, 30000, '画面の表示（開発サーバー）')
  return dev
}

// 起動中の所有プロセス（npm・electron-vite・Electron とその子孫、一時userDataを引数に持つプロセス）
export function ownedProcesses(dev, userDataDir) {
  const tree = [...processTree(dev.pgid)].map((pid) => ({ pid, command: commandOf(pid) ?? '' }))
  const byPath = processesWith(userDataDir)
  const all = new Map([...tree, ...byPath].map((p) => [p.pid, p]))
  return [...all.values()]
}

async function verifyAllGone(processes, dev, label) {
  const deadline = Date.now() + 15000
  let remaining = processes.filter((p) => alive(p.pid))
  while (remaining.length > 0 && Date.now() < deadline) {
    await sleep(300)
    remaining = processes.filter((p) => alive(p.pid))
  }
  assert(remaining.length === 0, `${label}: この起動のプロセスを残さない`, remaining)
  assert(listeningAddresses(dev.rendererPort).length === 0, `${label}: 開発サーバーのポート ${dev.rendererPort} を解放`)
  assert(listeningAddresses(dev.cdpPort).length === 0, `${label}: デバッグポート ${dev.cdpPort} を解放`)
}

// 失敗時の後始末（自分のプロセスグループと、この起動のプロセスだけ）
async function cleanupDev(dev, processes) {
  dev?.cdp?.close()
  if (dev && dev.exitInfo === null) dev.signalGroup('SIGKILL')
  for (const p of processes ?? []) if (alive(p.pid)) process.kill(p.pid, 'SIGKILL')
  await sleep(300)
}

export function exitScenarios({ withApp, root }) {
  const appDir = join(root, 'userData-exit-app')
  const devDir = join(root, 'userData-exit-dev')
  const devDir2 = join(root, 'userData-exit-dev2')
  const devDir3 = join(root, 'userData-exit-dev3')
  const otherDir = join(root, 'userData-exit-other')
  const TASK = U(9001)
  const seed = (dir) => seedDatabase(dir, { tasks: [{ id: TASK, title: '終了のタスク', createdAt: BASE }] })
  const title = (dir) => readDb(dir, 'SELECT title FROM tasks WHERE id = ?', TASK)[0]?.title
  // 一覧のタスク名をインライン編集し、未保存の入力を作る
  const makeDraft = async (c, value) => {
    await c.waitFor(`location.hash === '#/inbox' && ${rowOf(TASK)}`, 15000, 'Inbox')
    await sleep(300)
    await doubleClick(c, `document.querySelector('[data-task-id="${TASK}"] [data-testid=task-title]')`)
    await c.waitFor(`document.activeElement === document.querySelector('[data-testid=inline-title-editor] input')`, 3000, 'インライン編集')
    await c.setInput('[data-testid=inline-title-editor] input', value)
  }
  // × と同じ経路（BrowserWindow.close → close イベント）でウィンドウを閉じる要求をする。
  // テストモードの Main が SIGUSR2 を受けて mainWindow.close() を呼ぶ（画面側の window.close() は×と同じ経路ではないため使わない）
  const closeWindow = (pid) => process.kill(pid, 'SIGUSR2')
  const electronOf = (owned) => owned.find((p) => p.command.includes('Electron.app/Contents/MacOS/Electron'))

  return [
    [
      '終了（5.9）: × は保存確認を通って終了（キャンセルならウィンドウもアプリも残る）、⌘Q 相当（app.quit）も同じ確認',
      async () => {
        await seed(appDir)
        await withApp(
          {
            label: 'exit-close',
            userDataDir: appDir,
            dialogAnswers: [
              { message: DRAFT_MESSAGE, button: 'キャンセル' },
              { message: DRAFT_MESSAGE, button: 'キャンセル' },
              { message: DRAFT_MESSAGE, button: '保存して終了' }
            ]
          },
          async (app) => {
            const c = app.cdp
            await makeDraft(c, '×で保存')
            // × → 未保存の確認（文言は「終了」）→ キャンセル: ウィンドウ・アプリ・入力は残る
            closeWindow(app.pid)
            await sleep(1500)
            assert(app.exitInfo === null, 'キャンセルなら終了しない')
            assert((await c.evaluate(`document.querySelector('[data-testid=inline-title-editor] input')?.value`)) === '×で保存', 'ウィンドウと入力は残る')
            assert(app.logs.some((l) => l.includes('"chosen":"キャンセル"') && l.includes('保存して終了')), '× の確認は「終了」の選択肢', app.logs.filter((l) => l.includes('[test-dialog]')))
            // ⌘Q 相当（app.quit。SIGTERM も Electron が app.quit として扱う）→ 同じ確認 → キャンセル
            app.signal('SIGTERM')
            await sleep(1500)
            assert(app.exitInfo === null, '⌘Q 相当もキャンセルなら終了しない')
            // もう一度 × → 保存して終了 → 保存の完了後に終了（プロセスも終了）
            closeWindow(app.pid)
            const exit = await app.waitExit(15000)
            assert(exit?.code === 0, '保存して終了（最後のウィンドウを閉じたら macOS でも終了）', exit)
            assert(title(appDir) === '×で保存', '保存の完了を待って終了', title(appDir))
            assert(app.logs.some((l) => l.includes('[db] closed')), 'DBを閉じてから終了')
          }
        )
      }
    ],
    [
      '開発起動（5.9）: × で保存確認 → 保存して終了すると、npm・electron-vite・開発サーバー・Electron をすべて残さない',
      async () => {
        await seed(devDir)
        let dev = null
        let owned = []
        try {
          dev = await launchDev({ userDataDir: devDir, dialogAnswers: [{ message: DRAFT_MESSAGE, button: '保存して終了' }] })
          const c = dev.cdp
          await makeDraft(c, '開発起動で保存')
          owned = ownedProcesses(dev, devDir)
          const kinds = { npm: owned.some((p) => /\bnpm\b/.test(p.command)), vite: owned.some((p) => p.command.includes('electron-vite')), electron: owned.some((p) => p.command.includes('Electron')) }
          assert(kinds.npm && kinds.vite && kinds.electron, '所有プロセスの構成（npm → electron-vite（開発サーバー）→ Electron）', owned)
          assert(listeningAddresses(dev.rendererPort).length > 0, '開発サーバーが専用ポートで待ち受ける')
          closeWindow(electronOf(owned).pid)
          const exit = await dev.waitExit(30000)
          assert(exit !== null && exit.code === 0, 'npm run dev も正常に終了する', { exit, logs: dev.logs.slice(-15) })
          await verifyAllGone(owned, dev, '×')
          assert(title(devDir) === '開発起動で保存', '保存してから終了', title(devDir))
          assert(dev.logs.some((l) => l.includes('[db] closed')), 'DBを閉じてから終了')
          assert(!dev.logs.some((l) => l.includes('[test-dialog] FAIL')), 'ダイアログの回答漏れなし', dev.logs.filter((l) => l.includes('[test-dialog]')))
        } finally {
          await cleanupDev(dev, owned)
        }
      }
    ],
    [
      '開発起動（5.9）: × の終了をキャンセルすると開発環境は残り、Ctrl+C 相当（SIGINT）で保存確認を通って終了する。無関係な Node・Electron は終了しない',
      async () => {
        await seed(devDir2)
        let dev = null
        let owned = []
        // 無関係なプロセス: 別の Node（引数に electron-vite を含めても巻き込まない）と、別のuserDataの Electron
        const decoy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'electron-vite', 'dev'], { detached: true, stdio: 'ignore' })
        const other = await launchApp({ mode: 'hidden', userDataDir: otherDir, label: 'exit-other' })
        try {
          dev = await launchDev({
            userDataDir: devDir2,
            dialogAnswers: [
              { message: DRAFT_MESSAGE, button: 'キャンセル' },
              { message: DRAFT_MESSAGE, button: '保存せずに終了' }
            ]
          })
          const c = dev.cdp
          await makeDraft(c, '保存しない入力')
          owned = ownedProcesses(dev, devDir2)
          closeWindow(electronOf(owned).pid)
          await sleep(2000)
          assert(dev.exitInfo === null && owned.every((p) => alive(p.pid)), 'キャンセルなら npm・開発サーバー・Electron は残る')
          assert((await c.evaluate(`document.querySelector('[data-testid=inline-title-editor] input')?.value`)) === '保存しない入力', 'ウィンドウと入力は残る')
          assert(listeningAddresses(dev.rendererPort).length > 0, '開発サーバーも動いている')
          // Ctrl+C 相当: 自分のプロセスグループにだけ SIGINT
          dev.signalGroup('SIGINT')
          const exit = await dev.waitExit(30000)
          assert(exit !== null, 'SIGINT で終了する', dev.logs.slice(-15))
          await verifyAllGone(owned, dev, 'SIGINT')
          assert(dev.logs.some((l) => l.includes('[exit] 保存の確認結果')) && dev.logs.some((l) => l.includes('"chosen":"保存せずに終了"')), 'SIGINT でも保存確認を通る', dev.logs.filter((l) => l.includes('[exit]') || l.includes('[test-dialog]')))
          assert(dev.logs.some((l) => l.includes('[db] closed')), 'DBを閉じてから終了')
          assert(title(devDir2) === '終了のタスク', '保存せずに終了（入力だけ破棄）', title(devDir2))
          assert(alive(decoy.pid), '無関係な Node は終了しない')
          assert(other.exitInfo === null && alive(other.pid), '別の Electron（別のuserData）は終了しない')
        } finally {
          await cleanupDev(dev, owned)
          if (alive(decoy.pid)) process.kill(decoy.pid, 'SIGKILL')
          const quit = await requestQuit(other)
          assert(quit?.code === 0, '別の Electron を正常終了', quit)
        }
      }
    ],
    [
      '開発起動（5.9）: 親の electron-vite が強制終了されても、Electron は保存確認を通って終了し残らない',
      async () => {
        await seed(devDir3)
        let dev = null
        let owned = []
        try {
          dev = await launchDev({ userDataDir: devDir3 })
          await dev.cdp.waitFor(`location.hash === '#/inbox'`, 10000, 'Inbox')
          owned = ownedProcesses(dev, devDir3)
          const vite = owned.find((p) => p.command.includes('electron-vite') && !/\bnpm\b/.test(p.command) && !p.command.startsWith('sh '))
          const electron = owned.find((p) => p.command.includes('Electron.app/Contents/MacOS/Electron'))
          assert(vite && electron, 'electron-vite と Electron のプロセス', owned)
          assert(dev.logs.some((l) => l.includes('開発起動の親プロセス') && l.includes('監視します')), 'Electron が親プロセスを監視している')
          process.kill(vite.pid, 'SIGKILL')
          const deadline = Date.now() + 15000
          while (alive(electron.pid) && Date.now() < deadline) await sleep(300)
          assert(!alive(electron.pid), '親の消失を検知して Electron も終了する', dev.logs.slice(-15))
          assert(dev.logs.some((l) => l.includes('親プロセス') && l.includes('終了したため')) && dev.logs.some((l) => l.includes('[db] closed')), '通常の終了フロー（保存確認・DBを閉じる）を通る', dev.logs.filter((l) => l.includes('[exit]') || l.includes('[db]')))
          await dev.waitExit(15000)
          await verifyAllGone(owned, dev, '親の強制終了')
        } finally {
          await cleanupDev(dev, owned)
          // electron-vite dev が作り直した out/main・out/preload を本番用のビルドへ戻す（以降の起動・パッケージに開発用の出力を残さない）
          execFileSync('npx', ['electron-vite', 'build'], { cwd: PROJECT_ROOT, stdio: 'ignore' })
        }
      }
    ]
  ]
}
