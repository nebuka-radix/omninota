// UIテストの共通処理（依存の追加なし。Node.js 標準の fetch / WebSocket / child_process だけを使う）。
// - アプリは GTD_TEST_UI（hidden / secondary）で起動し、自分が起動した子プロセスだけを操作・終了する。
// - 操作は対象ページへのCDP（DOM・Input.dispatchKeyEvent）に限定する。OS全体へのキー入力・マウス操作はしない。
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const electronBinary = require('electron')

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ループバックで空いているポートを1つ得る
export async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

// 指定ポートで待ち受けているアドレス（lsofの読み取りのみ）
export function listeningAddresses(port) {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8' })
    return out.split('\n').filter((line) => line.startsWith('n')).map((line) => line.slice(1))
  } catch {
    return []
  }
}

// 最前面のアプリのPID（lsappinfoの読み取りのみ。他アプリの前面化などはしない）
function frontmostPid() {
  try {
    const asn = execFileSync('lsappinfo', ['front'], { encoding: 'utf8' }).trim()
    const info = execFileSync('lsappinfo', ['info', '-only', 'pid', asn], { encoding: 'utf8' })
    const match = /"pid"=(\d+)/.exec(info)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

export function processTree(rootPid) {
  try {
    const out = execFileSync('ps', ['-Ao', 'pid=,ppid='], { encoding: 'utf8' })
    const pairs = out.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number))
    const result = new Set([rootPid])
    let added = true
    while (added) {
      added = false
      for (const [pid, ppid] of pairs) {
        if (result.has(ppid) && !result.has(pid)) {
          result.add(pid)
          added = true
        }
      }
    }
    return result
  } catch {
    return new Set([rootPid])
  }
}

export class TestFailure extends Error {}
export function assert(condition, message, detail) {
  if (!condition) throw new TestFailure(detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`)
}

// アプリを起動する。userDataDir は呼び出し側が作った一時ディレクトリ。
export async function launchApp({ mode, userDataDir, dialogAnswers = [], displayId, label }) {
  if (!existsSync(join(PROJECT_ROOT, 'out', 'main', 'index.js'))) {
    throw new Error('out/ がありません。先に npm run build を実行してください（npm run test:ui は自動でビルドします）')
  }
  const port = await freePort()
  const env = { ...process.env, GTD_TEST_UI: mode, GTD_DEV_USER_DATA_DIR: userDataDir }
  delete env.ELECTRON_RENDERER_URL // ビルド済みのファイルを読み込む（開発サーバーは使わない）
  delete env.GTD_TEST_DIALOG_ANSWERS
  delete env.GTD_TEST_DISPLAY_ID
  if (dialogAnswers.length > 0) env.GTD_TEST_DIALOG_ANSWERS = JSON.stringify(dialogAnswers)
  if (displayId !== undefined && displayId !== null) env.GTD_TEST_DISPLAY_ID = String(displayId)

  const child = spawn(electronBinary, ['.', `--remote-debugging-port=${port}`], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const logs = []
  const onData = (chunk) => logs.push(...chunk.toString().split('\n').filter(Boolean))
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  let exitInfo = null
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      exitInfo = { code, signal }
      resolve(exitInfo)
    })
  })

  // 最前面のアプリが、テスト対象のプロセスにならないことを監視する
  const focusViolations = []
  const monitor = setInterval(() => {
    const front = frontmostPid()
    if (front !== null && processTree(child.pid).has(front)) focusViolations.push(new Date().toISOString())
  }, 250)

  const app = {
    label,
    pid: child.pid,
    port,
    logs,
    focusViolations,
    exited,
    get exitInfo() {
      return exitInfo
    },
    // 自分が起動したプロセスにだけシグナルを送る（killall などの一括終了はしない）
    signal(sig) {
      if (exitInfo === null) child.kill(sig)
    },
    async waitExit(timeoutMs = 15000) {
      const result = await Promise.race([exited, sleep(timeoutMs).then(() => null)])
      return result
    },
    stopMonitor() {
      clearInterval(monitor)
    },
    dialogFailures() {
      return logs.filter((line) => line.includes('[test-dialog] FAIL'))
    }
  }

  // ページ（CDPのターゲット）が現れるのを待つ。起動前に終了した場合はその理由を返す
  const deadline = Date.now() + 30000
  for (;;) {
    if (exitInfo !== null) return app
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json()
      const page = targets.find((target) => target.type === 'page')
      if (page) {
        app.cdp = await connectCdp(page.webSocketDebuggerUrl)
        break
      }
    } catch {
      // まだ待ち受けていない
    }
    if (Date.now() > deadline) {
      app.signal('SIGKILL')
      throw new Error(`起動を確認できませんでした: ${logs.join('\n')}`)
    }
    await sleep(200)
  }
  // 非表示・非アクティブでもフォーカスがある前提で操作できるようにする（ページ内だけの擬似。OSのフォーカスは変えない）
  await app.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await app.cdp.waitFor(`!!document.querySelector('nav button[aria-label="Inbox"]')`, 15000, '画面の表示')
  return app
}

// アプリの終了を要求する（SIGTERM → Electronが app.quit() として扱い、before-quit の保存確認を通る）
export async function requestQuit(app, timeoutMs = 15000) {
  app.cdp?.close()
  app.signal('SIGTERM')
  return app.waitExit(timeoutMs)
}

// 異常時の後始末（自分の子プロセスだけ）
export async function forceStop(app) {
  app.cdp?.close()
  if (app.exitInfo === null) {
    app.signal('SIGKILL')
    await app.waitExit(5000)
  }
  app.stopMonitor()
}

export async function connectCdp(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (message) => {
    const data = JSON.parse(message.data)
    const callback = pending.get(data.id)
    if (callback) {
      pending.delete(data.id)
      callback(data)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) return reject(new Error('CDPの接続が閉じています'))
      const requestId = ++id
      pending.set(requestId, (data) => (data.error ? reject(new Error(`${method}: ${data.error.message}`)) : resolve(data.result)))
      ws.send(JSON.stringify({ id: requestId, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(`評価に失敗: ${JSON.stringify(result.exceptionDetails).slice(0, 300)}`)
    return result.result.value
  }
  const waitFor = async (expression, timeoutMs = 5000, label = expression) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (await evaluate(`Boolean(${expression})`)) return
      if (Date.now() > deadline) {
        // 失敗の原因を追えるよう、その時点の画面の状態を添える
        const context = await evaluate(
          `({ hash: location.hash, dialog: document.querySelector('[role=dialog]')?.innerText ?? null, active: document.activeElement ? document.activeElement.tagName + ':' + (document.activeElement.getAttribute('aria-label') ?? document.activeElement.getAttribute('data-testid') ?? '') : null, main: document.querySelector('main')?.innerText.replace(/\\n+/g, ' / ').slice(0, 200) ?? null })`
        ).catch(() => null)
        throw new TestFailure(`待機がタイムアウトしました: ${label} ${JSON.stringify(context)}`)
      }
      await sleep(100)
    }
  }
  // 対象ページにだけキー入力を送る
  const key = async (keyName, keyCode, extra = {}) => {
    const code = extra.code ?? keyName
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: keyCode })
    if (extra.text) await send('Input.dispatchKeyEvent', { type: 'char', key: keyName, text: extra.text })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode })
  }
  const enter = () => key('Enter', 13, { text: '\r' })
  const space = () => key(' ', 32, { code: 'Space', text: ' ' })
  const insertText = (text) => send('Input.insertText', { text })
  // DOM要素をクリックする（対象ページへのマウスイベント。OSのカーソルは動かさない）
  const click = async (selectorExpr) => {
    const pos = await evaluate(
      `(() => { const e = ${selectorExpr}; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`
    )
    if (!pos) throw new TestFailure(`要素が見つかりません: ${selectorExpr}`)
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: 'left', clickCount: 1 })
    }
    await sleep(150)
  }
  const focus = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
  const setInput = async (selector, value) => {
    const found = await evaluate(
      `(() => { const i = document.querySelector(${JSON.stringify(selector)}); if (!(i instanceof HTMLInputElement)) return false; const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
    )
    if (!found) {
      const context = await evaluate(`({ hash: location.hash, detail: document.querySelector('#detail-panel')?.innerText.slice(0, 160) ?? null, dialog: document.querySelector('[role=dialog]')?.innerText ?? null })`)
      throw new TestFailure(`入力欄が見つかりません: ${selector} ${JSON.stringify(context)}`)
    }
    await sleep(100)
  }
  const byText = (selector, text) =>
    `[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)})`
  return { send, evaluate, waitFor, key, enter, space, insertText, click, focus, setInput, byText, close: () => ws.close() }
}

// テスト終了後のDBを読み取り専用で開く（アプリの終了後に使う）
export function openDatabaseReadOnly(file) {
  const Database = require('better-sqlite3')
  return new Database(file, { readonly: true, fileMustExist: true })
}

// 一時DBを作り、先頭 count 件のマイグレーションだけを適用する（過去のフェーズのDBの再現・大量データの準備用）。
// count を省略すると全件。アプリと同じ drizzle-orm の migrator を使う。テスト用の一時ディレクトリにだけ使うこと。
export async function createDatabaseAt(file, count) {
  const { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  const Database = require('better-sqlite3')
  const { drizzle } = require('drizzle-orm/better-sqlite3')
  const { migrate } = require('drizzle-orm/better-sqlite3/migrator')
  const source = join(PROJECT_ROOT, 'migrations')
  let folder = source
  mkdirSync(dirname(file), { recursive: true })
  if (count !== undefined) {
    folder = mkdtempSync(join(dirname(file), 'migrations-'))
    const journal = JSON.parse(readFileSync(join(source, 'meta', '_journal.json'), 'utf8'))
    const entries = journal.entries.slice(0, count)
    mkdirSync(join(folder, 'meta'), { recursive: true })
    writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
    for (const entry of entries) copyFileSync(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  }
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  migrate(drizzle(sqlite), { migrationsFolder: folder })
  return sqlite
}

// インライン入力（NEW TASK など）を、登録の完了（入力が空に戻り、編集できる状態）を待ってから Esc で閉じる
export async function closeInlineCreate(c, testId) {
  const input = `document.querySelector('[data-testid="${testId}"] input')`
  await c.waitFor(`${input} && ${input}.value === '' && !${input}.readOnly`, 5000, `${testId} の登録完了`)
  await c.focus(`[data-testid="${testId}"] input`)
  await c.key('Escape', 27)
  await c.waitFor(`!${input}`, 3000, `${testId} を閉じる`)
  // 閉じた後、フォーカスがボタンへ戻る（戻る時のスクロールが終わってから次の操作をする）
  await c.waitFor(`document.activeElement === document.querySelector('[data-testid="${testId}-button"]')`, 3000, `${testId} のボタンへフォーカス`)
  await sleep(100)
}

// プロジェクトの最初のマイルストン（作成時に自動で作られる「新しいマイルストン」。フェーズ5.6）のID。なければ null
export async function firstMilestoneId(c, projectId) {
  return c.evaluate(
    `window.gtd.milestones.list().then((r) => r.data.filter((m) => m.projectId === ${JSON.stringify(projectId)}).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))[0]?.id ?? null)`
  )
}

// プロジェクトを開く（フェーズ5.8）。未完了のプロジェクトはサイドバーの項目をクリックする。
// 完了済みのプロジェクトはサイドバーに表示されないため、テストだけルート（ハッシュ）で開く
// （画面の遷移は通常と同じ Router・未保存確認を通る）。
export async function goToProject(c, projectId) {
  const item = `document.querySelector('[data-testid=project-list] [data-project-id="${projectId}"]')`
  if (await c.evaluate(`!!${item}`)) {
    await c.click(item)
    return
  }
  const completed = await c.evaluate(
    `window.gtd.projects.list().then((r) => r.data.find((p) => p.id === ${JSON.stringify(projectId)})?.completedAt != null)`
  )
  // 未完了なのにサイドバーにない場合は失敗にする（ルートで開いて隠さない）
  if (!completed) throw new TestFailure(`未完了のプロジェクトがサイドバーにありません: ${projectId}`)
  await c.evaluate(`location.hash = ${JSON.stringify(`#/projects/${projectId}`)}`)
}

// --- フェーズ5.9: ドラッグ・修飾キー（対象ページへのCDPの入力だけ。OSのカーソル・キー入力は使わない） ---
// 修飾キー（CDP）: Alt=1, Ctrl=2, Meta(⌘)=4, Shift=8
export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }

// 要素の中心（または相対位置 rx, ry）の座標。見つからなければ失敗
export async function pointOf(c, selectorExpr, { rx = 0.5, ry = 0.5, scroll = true } = {}) {
  const pos = await c.evaluate(
    `(() => { const e = ${selectorExpr}; if (!e) return null; ${scroll ? "e.scrollIntoView({ block: 'nearest', inline: 'nearest' });" : ''} const r = e.getBoundingClientRect(); return { x: r.left + r.width * ${rx}, y: r.top + r.height * ${ry} } })()`
  )
  if (!pos) throw new TestFailure(`要素が見つかりません: ${selectorExpr}`)
  return pos
}

// 修飾キー付きのクリック（⌘+クリック・Shift+クリック）
export async function clickWith(c, selectorExpr, modifiers = 0) {
  const { x, y } = await pointOf(c, selectorExpr)
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await c.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, modifiers })
  }
  await sleep(120)
}

export async function doubleClick(c, selectorExpr) {
  const { x, y } = await pointOf(c, selectorExpr)
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  for (const clickCount of [1, 2]) {
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount })
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount })
  }
  await sleep(150)
}

// ボタンを押したまま動かす（ドラッグ）。points を順に通る。release: false なら押したまま返す（途中の確認用）
export async function mouseDown(c, point) {
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 })
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
}
export async function mouseMoveTo(c, from, to, steps = 8) {
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps
    const y = from.y + ((to.y - from.y) * i) / steps
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
    await sleep(16)
  }
}
export async function mouseUp(c, point) {
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(150)
}

// 修飾キー付きのキー入力
export async function keyWith(c, key, keyCode, modifiers = 0, code = key) {
  await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers })
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers })
  await sleep(60)
}

// 行をクリックして、その詳細を表示する（フェーズ5.9）。Inboxでは行の選択だけでは右サイドバーが「紐付け先」のままのため、
// 明示的な操作（「タスク詳細」タブ）で詳細へ切り替える。プロジェクトの画面では従来どおりクリックで詳細を表示する
export async function clickRowShowDetail(c, selectorExpr) {
  await c.click(selectorExpr)
  if (await c.evaluate(`!!document.querySelector('[data-inbox-panel=targets]')`)) {
    await c.click(`document.querySelector('[data-testid=inbox-panel-tab-detail]')`)
    await c.waitFor(`document.querySelector('[data-inbox-panel=detail]')`, 3000, '右サイドバーをタスク詳細に切り替え')
  }
}

// プロジェクト画面の並べ替えを選ぶ（フェーズ5.9からトップバーの選択式: manual / created-asc / created-desc / title）
export async function chooseProjectSort(c, key) {
  await c.click(`document.querySelector('[data-testid=view-sort-select] [role=combobox]')`)
  await c.waitFor(`document.querySelector('[data-sort-key=${key}]')`, 3000, '並べ替えの選択肢')
  await sleep(150)
  await c.click(`document.querySelector('[data-sort-key=${key}]')`)
  await c.waitFor(`!document.querySelector('[data-sort-key=${key}]')`, 3000, '選択肢を閉じる')
  await sleep(200)
}
