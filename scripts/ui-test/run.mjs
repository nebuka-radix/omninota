// UIテストの実行（Electronの非表示ウィンドウ、またはセカンダリディスプレイへの非アクティブ表示）。
// 使い方: node scripts/ui-test/run.mjs <hidden|secondary> [--display <ID>] [--keep]
//   npm run test:ui            … hidden（ビルドしてから実行）
//   npm run test:ui:secondary  … secondary（GTD_TEST_DISPLAY_ID か --display で表示先を指定できる）
// 一時userDataは os.tmpdir() に作り、すべて成功したら削除する（失敗時・--keep 指定時は残して場所を表示する）。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assert,
  forceStop,
  launchApp,
  listeningAddresses,
  openDatabaseReadOnly,
  requestQuit,
  sleep,
  TestFailure
} from './lib.mjs'
import { taskProjectScenarios } from './scenarios-task-projects.mjs'

const args = process.argv.slice(2)
const mode = args[0]
if (mode !== 'hidden' && mode !== 'secondary') {
  console.error('使い方: node scripts/ui-test/run.mjs <hidden|secondary> [--display <ID>] [--keep]')
  process.exit(2)
}
const displayArgIndex = args.indexOf('--display')
const displayId = displayArgIndex >= 0 ? args[displayArgIndex + 1] : process.env.GTD_TEST_DISPLAY_ID
const keep = args.includes('--keep')

const root = mkdtempSync(join(tmpdir(), 'gtd-ui-test-'))
const mainDir = join(root, 'userData')
const otherDir = join(root, 'userData-other')

// 起動したアプリごとの共通確認: 最前面にならない、フォーカスを取らない、表示の有無、ダイアログの回答漏れ、ポートの解放
async function withApp(options, body) {
  const app = await launchApp({ mode, displayId, userDataDir: mainDir, ...options })
  if (app.exitInfo !== null) {
    const reason = app.logs.findLast((line) => line.includes('[test]')) ?? app.logs.join('\n')
    throw new StartupStop(`アプリが起動直後に終了しました（${JSON.stringify(app.exitInfo)}）: ${reason}`)
  }
  try {
    await body(app)
  } finally {
    await forceStop(app)
  }
  verifyCommon(app, options)
  return app
}

class StartupStop extends Error {}

function verifyCommon(app, options = {}) {
  assert(app.focusViolations.length === 0, 'テスト対象のアプリが最前面になりました', app.focusViolations)
  assert(!app.logs.some((line) => line.includes('[test] window-focus')), 'ウィンドウがフォーカスを取りました')
  const shown = app.logs.filter((line) => line.includes('[test] window-show'))
  if (mode === 'hidden') {
    assert(shown.length === 0, '非表示モードでウィンドウが表示されました', shown)
  } else {
    assert(shown.length === 1, 'セカンダリ表示でウィンドウが1回だけ表示されること', shown)
    const target = app.logs.find((line) => line.includes('[test] 表示先ディスプレイ'))
    const workArea = JSON.parse(/workArea=(\{[^}]*\})/.exec(target)[1])
    const bounds = JSON.parse(/bounds=(\{[^}]*\})/.exec(shown[0])[1])
    const inside =
      bounds.x >= workArea.x &&
      bounds.y >= workArea.y &&
      bounds.x + bounds.width <= workArea.x + workArea.width &&
      bounds.y + bounds.height <= workArea.y + workArea.height
    assert(inside, '表示位置が表示先の作業領域に収まること', { workArea, bounds })
  }
  if (!options.expectDialogFailure) {
    assert(app.dialogFailures().length === 0, 'ダイアログの回答漏れ・不一致', app.dialogFailures())
  }
  assert(listeningAddresses(app.port).length === 0, `終了後もデバッグポート ${app.port} が開いています`)
}

const projectSelector = (id) =>
  `[...document.querySelectorAll('[data-testid=project-list] [data-project-id]')].find((e) => e.dataset.projectId === ${JSON.stringify(id)})`
const projectList = (c) => c.evaluate(`window.gtd.projects.list().then((r) => r.data)`)
const projectNameInDb = (id) => {
  const db = openDatabaseReadOnly(join(mainDir, 'gtd.sqlite'))
  try {
    return db.prepare('SELECT name FROM projects WHERE id = ?').get(id)?.name
  } finally {
    db.close()
  }
}
let projectId = null

const scenarios = [
  [
    mode === 'hidden'
      ? '起動: 表示・フォーカスなしで描画され、スクリーンショットを取れる'
      : '起動: 表示先の作業領域内に、フォーカスを取らずに表示・描画され、スクリーンショットを取れる',
    () =>
      withApp({ label: 'startup' }, async (app) => {
        const c = app.cdp
        assert(listeningAddresses(app.port).every((address) => address.startsWith('127.0.0.1:')), 'デバッグポートはループバックだけ', listeningAddresses(app.port))
        const frame = await c.evaluate(
          'new Promise((r) => { const t = setTimeout(() => r("timeout"), 1000); requestAnimationFrame(() => { clearTimeout(t); r("ok") }) })'
        )
        assert(frame === 'ok', '描画フレームが進むこと（requestAnimationFrame）', frame)
        const shot = Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
        assert(shot.length > 10000 && shot.readUInt32BE(16) > 0, 'スクリーンショットを取得できること', shot.length)
        writeFileSync(join(root, `startup-${mode}.png`), shot)
        const info = await c.evaluate('window.gtd.app.getInfo().then((r) => r.data)')
        assert(info.userDataPath === mainDir, '一時userDataを使うこと', info.userDataPath)
        const quit = await requestQuit(app)
        assert(quit?.code === 0, '終了要求（SIGTERM）で正常終了すること', quit)
      })
  ],
  [
    'Inbox: 追加・編集・完了／未完了',
    () =>
      withApp({ label: 'inbox' }, async (app) => {
        const c = app.cdp
        const tasks = () => c.evaluate('window.gtd.tasks.list().then((r) => r.data)')
        await c.focus('input[aria-label="タスクのタイトル"]')
        await c.insertText('UIテストのタスク')
        await c.enter()
        await c.waitFor(`document.querySelectorAll('[data-testid=task-list] [role=option]').length === 1`, 5000, '一覧に追加')
        const [task] = await tasks()
        assert(task?.title === 'UIテストのタスク' && task.completedAt === null, '追加', task)
        await c.click(`document.querySelector('[data-testid=task-list] [role=option]')`)
        await c.waitFor(`document.querySelector('[data-testid=task-editor] input')`, 3000, '詳細の表示')
        await c.setInput('[data-testid=task-editor] input', 'UIテストのタスク（編集）')
        await c.focus('[data-testid=task-editor] input')
        await c.enter()
        await sleep(500)
        assert((await tasks())[0].title === 'UIテストのタスク（編集）', '編集（Enterで保存）')
        await c.click(c.byText('button', 'すべて'))
        await c.focus('[data-testid=task-list]')
        await c.space()
        await sleep(500)
        assert((await tasks())[0].completedAt !== null, 'Spaceで完了')
        await c.space()
        await sleep(500)
        assert((await tasks())[0].completedAt === null, 'もう一度Spaceで未完了')
        const quit = await requestQuit(app)
        assert(quit?.code === 0, '正常終了', quit)
      })
  ],
  [
    'Projects: 作成・名前変更・画面遷移時の未保存確認',
    () =>
      withApp({ label: 'projects' }, async (app) => {
        const c = app.cdp
        await c.click(`document.querySelector('nav button[aria-label="Projects"]')`)
        for (const name of ['UIテストA', 'UIテストB']) {
          await c.focus('input[aria-label="新しいプロジェクトの名前"]')
          await c.insertText(name)
          await c.enter()
          await sleep(500)
        }
        const projects = await projectList(c)
        assert(projects.length === 2, '作成', projects)
        projectId = projects.find((p) => p.name === 'UIテストA').id
        await c.click(projectSelector(projectId))
        await c.click(`document.querySelector('button[aria-label="プロジェクト名を変更"]')`)
        await c.setInput('[data-testid=project-name-editor] input', 'UIテストA2')
        await c.focus('[data-testid=project-name-editor] input')
        await c.enter()
        await sleep(500)
        assert((await projectList(c)).find((p) => p.id === projectId).name === 'UIテストA2', '名前変更')

        await c.click(`document.querySelector('button[aria-label="プロジェクト名を変更"]')`)
        await c.setInput('[data-testid=project-name-editor] input', '未保存のドラフト')
        await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
        await c.waitFor(`document.querySelector('[role=dialog]')?.innerText.includes('プロジェクト名の変更を保存しますか')`, 3000, 'アプリ内の確認')
        await c.click(c.byText('[role=dialog] button', 'キャンセル'))
        await sleep(400)
        assert((await c.evaluate('location.hash')) === `#/projects/${projectId}`, 'キャンセルで移動しない')
        await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
        await c.waitFor(`document.querySelector('[role=dialog]')`, 3000, 'アプリ内の確認（2回目）')
        await c.click(c.byText('[role=dialog] button', '破棄'))
        await c.waitFor(`location.hash === '#/inbox'`, 3000, '破棄して移動')
        assert((await projectList(c)).find((p) => p.id === projectId).name === 'UIテストA2', '破棄した名前は保存しない')
        // 次のシナリオ（終了・復元）のため、このプロジェクトを開いて終了する
        await c.click(`document.querySelector('nav button[aria-label="Projects"]')`)
        await c.click(projectSelector(projectId))
        await sleep(400)
        const quit = await requestQuit(app)
        assert(quit?.code === 0, '正常終了', quit)
      })
  ],
  [
    '再起動: 最後に開いたプロジェクトを復元する',
    () =>
      withApp({ label: 'restore' }, async (app) => {
        const c = app.cdp
        await c.waitFor(`location.hash === ${JSON.stringify(`#/projects/${projectId}`)}`, 5000, '画面の復元')
        await c.waitFor(`document.querySelector('[data-testid=project-name]')?.textContent === 'UIテストA2'`, 5000, 'プロジェクト名の表示')
        const quit = await requestQuit(app)
        assert(quit?.code === 0, '正常終了', quit)
      })
  ],
  [
    '終了: プロジェクト名の編集中 →（指定した回答）保存して終了',
    () =>
      withApp(
        { label: 'exit-save', dialogAnswers: [{ message: 'プロジェクト名に未保存の変更があります', button: '保存して終了' }] },
        async (app) => {
          const c = app.cdp
          await c.waitFor(`document.querySelector('button[aria-label="プロジェクト名を変更"]')`, 5000, '見出しの表示')
          await c.click(`document.querySelector('button[aria-label="プロジェクト名を変更"]')`)
          await c.setInput('[data-testid=project-name-editor] input', 'UIテストA3（保存して終了）')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '保存して終了', quit)
          assert(app.logs.some((line) => line.includes('"chosen":"保存して終了"')), 'ダイアログの回答を使ったこと')
          assert(projectNameInDb(projectId) === 'UIテストA3（保存して終了）', '保存された名前', projectNameInDb(projectId))
        }
      )
  ],
  [
    '終了: ダイアログの回答が未指定なら失敗として扱い、保存も破棄もしない',
    () =>
      withApp({ label: 'exit-unanswered', expectDialogFailure: true }, async (app) => {
        const c = app.cdp
        await c.waitFor(`document.querySelector('button[aria-label="プロジェクト名を変更"]')`, 5000, '見出しの表示')
        await c.click(`document.querySelector('button[aria-label="プロジェクト名を変更"]')`)
        await c.setInput('[data-testid=project-name-editor] input', '保存されてはいけない名前')
        app.signal('SIGTERM')
        const quit = await app.waitExit(4000)
        assert(quit === null, '回答がなければ終了しない（キャンセル扱い）', quit)
        assert(app.dialogFailures().length === 1, '回答漏れを失敗として記録する', app.logs)
        const draft = await c.evaluate(`document.querySelector('[data-testid=project-name-editor] input')?.value`)
        assert(draft === '保存されてはいけない名前', 'ドラフトは画面に残る', draft)
        // 後始末: 自分の子プロセスだけを強制終了する（一時DBなので影響なし）
        await forceStop(app)
        assert(projectNameInDb(projectId) === 'UIテストA3（保存して終了）', '名前は変わらない', projectNameInDb(projectId))
      })
  ],
  [
    '多重起動: 同じuserDataの2つ目は終了し、既存を表示・前面化しない。別のuserDataとは干渉しない',
    () =>
      withApp({ label: 'first' }, async (first) => {
        const second = await launchApp({ mode, displayId, userDataDir: mainDir, label: 'second' })
        try {
          assert(second.exitInfo !== null || (await second.waitExit(5000)) !== null, '同じuserDataの2つ目は終了する')
        } finally {
          await forceStop(second)
        }
        await sleep(500)
        assert(first.logs.some((line) => line.includes('[test] 既存ウィンドウの表示・フォーカスは行いません')), '既存ウィンドウを表示・前面化しない')
        const other = await launchApp({ mode, displayId, userDataDir: otherDir, label: 'other' })
        try {
          assert(other.exitInfo === null, '別のuserDataなら同時に起動できる（通常利用・開発のアプリとも干渉しない）', other.logs)
          const quit = await requestQuit(other)
          assert(quit?.code === 0, '別のuserDataのアプリを正常終了', quit)
        } finally {
          await forceStop(other)
        }
        verifyCommon(other)
        const quit = await requestQuit(first)
        assert(quit?.code === 0, '最初のアプリを正常終了', quit)
      })
  ]
]

// フェーズ5.2: タスクのプロジェクト所属とプロジェクト内タスク表示
scenarios.push(...taskProjectScenarios({ withApp, root }))

console.log(`UIテスト（${mode}${displayId ? `、表示先 ${displayId}` : ''}）一時ディレクトリ: ${root}`)
let failed = 0
let stopped = null
for (const [name, run] of scenarios) {
  const started = Date.now()
  try {
    await run()
    console.log(`  ✓ ${name}（${Date.now() - started}ms）`)
  } catch (error) {
    if (error instanceof StartupStop) {
      stopped = error.message
      break
    }
    failed++
    console.log(`  ✗ ${name}\n      ${error instanceof TestFailure ? error.message : error.stack}`)
  }
}

if (stopped) {
  console.log(`\n停止しました: ${stopped}`)
  console.log(`一時ディレクトリ（残しています）: ${root}`)
  process.exit(3)
}
console.log(`\n${scenarios.length - failed} 件成功 / ${failed} 件失敗`)
if (failed === 0 && !keep) {
  rmSync(root, { recursive: true, force: true })
  console.log('一時ディレクトリを削除しました')
} else {
  console.log(`一時ディレクトリ（残しています）: ${root}`)
}
process.exit(failed === 0 ? 0 : 1)
