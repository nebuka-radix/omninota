// フェーズ5.3: プロジェクトの完了ルールのUIシナリオ。run.mjs から呼ぶ。専用の一時userData（root配下）だけを使う。
// 完了・取り消しは、画面の操作（見出しのボタン）と、Preloadが公開する用途別API（projects.setCompleted）で行う。DBは直接変更しない。
import { join } from 'node:path'
import { assert, requestQuit, sleep } from './lib.mjs'

export function projectCompletionScenarios({ withApp, root }) {
  const dir = join(root, 'userData-completion')
  const ids = {}

  const api = (c, expression) =>
    c.evaluate(`(${expression}).then((r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data })`)
  const apiRaw = (c, expression) => c.evaluate(expression)
  const project = async (c, id) => (await api(c, 'window.gtd.projects.list()')).find((p) => p.id === id)
  const task = async (c, id) => (await api(c, 'window.gtd.tasks.list()')).find((t) => t.id === id)
  const openProject = async (c, projectId) => {
    if (!(await c.evaluate(`!!document.querySelector('[data-testid=project-list]')`))) {
      await c.click(`document.querySelector('nav button[aria-label="Projects"]')`)
      await c.waitFor(`document.querySelector('[data-testid=project-list]')`, 5000, 'プロジェクト一覧')
    }
    await c.click(`document.querySelector('[data-testid=project-list] [data-project-id="${projectId}"]')`)
    await c.waitFor(`location.hash === ${JSON.stringify(`#/projects/${projectId}`)}`, 5000, 'プロジェクトを開く')
  }
  const listIds = (c) => c.evaluate(`[...document.querySelectorAll('[data-testid=task-list] [role=option]')].map((e) => e.dataset.taskId).sort()`)
  const statusText = (c) => c.evaluate(`document.querySelector('[data-testid=project-status]')?.textContent`)
  const pressed = (c, value) => c.evaluate(`document.querySelector('button[value=${value}]')?.getAttribute('aria-pressed') === 'true'`)
  const sectionOf = (c, projectId) =>
    c.evaluate(`(() => { const e = document.querySelector('[data-testid=project-list] [data-project-id="${projectId}"]'); if (!e) return null; return { section: e.closest('[data-testid^=project-section-]')?.dataset.testid, current: e.getAttribute('aria-current'), text: e.textContent } })()`)
  const clickCompletion = (c) => c.click(`document.querySelector('[data-testid=project-completion-button]')`)
  const titleInput = '[data-testid=task-editor] input:not([type=hidden])'
  const reload = async (c) => {
    await c.evaluate('location.reload()')
    await c.waitFor(`document.querySelector('nav button[aria-label="Inbox"]')`, 10000, '再読み込み')
    await sleep(500)
  }

  return [
    [
      'プロジェクトの完了: 未完了タスクがあれば件数つきで拒否 → 未完了タスクを表示（検索で隠れていても）→ 完了 → 区分・初期フィルター・操作制約 → 取り消し',
      () =>
        withApp({ label: 'completion', userDataDir: dir }, async (app) => {
          const c = app.cdp
          ids.p = (await api(c, `window.gtd.projects.create({ name: 'リリース' })`)).id
          ids.a = (await api(c, `window.gtd.tasks.create({ title: 'リリース資料', projectId: ${JSON.stringify(ids.p)} })`)).id
          ids.b = (await api(c, `window.gtd.tasks.create({ title: '告知文', projectId: ${JSON.stringify(ids.p)} })`)).id
          ids.c = (await api(c, `window.gtd.tasks.create({ title: '完了済みの準備', projectId: ${JSON.stringify(ids.p)} })`)).id
          await api(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(ids.c)}, completed: true })`)
          ids.inbox = (await api(c, `window.gtd.tasks.create({ title: '別の未完了（未所属）' })`)).id
          await reload(c)

          await openProject(c, ids.p)
          assert((await statusText(c)) === '未完了', '状態を文字で表示', await statusText(c))
          assert(await pressed(c, 'open'), '未完了のプロジェクトは「未完了」を初期表示')
          // 未完了タスクが検索・表示フィルターで見えない状態にしてから完了を試す
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '資料')
          await c.click(c.byText('button', '完了'))
          await sleep(200)
          await clickCompletion(c)
          await c.waitFor(`document.querySelector('[data-testid=project-completion-error]')`, 5000, '拒否の表示')
          const rejected = await c.evaluate(`document.querySelector('[data-testid=project-completion-error]').textContent`)
          assert(rejected.includes('未完了のタスクが 2 件あるため完了できません'), '件数つきの理由（画面の絞り込みに依存しない件数）', rejected)
          assert((await project(c, ids.p)).completedAt === null && (await statusText(c)) === '未完了', '拒否時は状態を変えない')

          await c.click(`document.querySelector('[data-testid=reveal-open-tasks]')`)
          await sleep(400)
          const revealed = await c.evaluate(`({ search: document.querySelector('input[aria-label="タイトルで絞り込み"]').value, hash: location.hash })`)
          assert(revealed.search === '' && (await pressed(c, 'open')) && revealed.hash === `#/projects/${ids.p}`, '未完了を表示し、隠れる検索をクリア（プロジェクトは維持）', revealed)
          assert(JSON.stringify(await listIds(c)) === JSON.stringify([ids.a, ids.b].sort()), '未完了のタスクが見える', await listIds(c))

          // キーボード（Space）で2件とも完了 → プロジェクトを完了
          await c.focus('[data-testid=task-list]')
          await c.key('Home', 36)
          await c.space()
          await sleep(500)
          await c.space()
          await sleep(500)
          assert((await task(c, ids.a)).completedAt !== null && (await task(c, ids.b)).completedAt !== null, 'Spaceで完了（回帰）')
          await clickCompletion(c)
          await c.waitFor(`document.querySelector('[data-testid=project-status]')?.textContent.startsWith('完了済み')`, 5000, '完了の確定表示')
          const done = await project(c, ids.p)
          assert(done.completedAt !== null && done.updatedAt === done.completedAt, '完了日時と更新日時', done)
          assert((await c.evaluate('location.hash')) === `#/projects/${ids.p}`, '完了しても同じプロジェクトの画面に留まる')
          const section = await sectionOf(c, ids.p)
          assert(section.section === 'project-section-completed' && section.current === 'page' && section.text.includes('完了済み'), 'サイドバーの「完了済み」区分へ移り、選択を維持（文字でも表示）', section)
          assert(await pressed(c, 'open'), '同じ画面のまま完了しても、表示フィルターは変えない')
          const add = await c.evaluate(`({ disabled: document.querySelector('input[aria-label="タスクのタイトル"]').disabled, text: document.querySelector('[data-testid=task-add-target]').textContent })`)
          assert(add.disabled && add.text.includes('完了済み'), '追加欄は無効で理由を表示', add)
          assert((await task(c, ids.inbox)).completedAt === null, '他のタスクは変わらない')

          // 別の画面へ移って戻ると、完了済みプロジェクトは「完了」を初期表示
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
          await c.waitFor(`location.hash === '#/inbox'`, 3000, 'Inbox')
          await openProject(c, ids.p)
          assert(await pressed(c, 'completed'), '完了済みプロジェクトは「完了」を初期表示')
          assert(JSON.stringify(await listIds(c)) === JSON.stringify([ids.a, ids.b, ids.c].sort()), '完了タスクが見える', await listIds(c))

          // 所属タスクを未完了に戻す操作は、画面で理由を示し、Mainでも拒否する
          await c.click(`document.querySelector('[data-testid=task-list] [data-task-id="${ids.a}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, '詳細')
          const editor = await c.evaluate(`({ disabled: [...document.querySelectorAll('[data-testid=task-editor] button')].find((b) => b.textContent.includes('未完了に戻す'))?.disabled, reason: document.querySelector('[data-testid=task-reopen-blocked]')?.textContent })`)
          assert(editor.disabled && editor.reason.includes('完了済みのプロジェクトのタスクは未完了に戻せません'), '詳細のボタンは無効で理由を表示', editor)
          await c.focus('[data-testid=task-list]')
          await c.key('Home', 36)
          await c.space()
          await sleep(400)
          const notice = await c.evaluate(`document.querySelector('[data-testid=task-blocked-notice]')?.textContent`)
          assert(notice?.includes('先にプロジェクトを未完了に戻してください'), '一覧のSpaceでも理由を表示', notice)
          const reopen = await apiRaw(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(ids.a)}, completed: false })`)
          assert(!reopen.ok && reopen.error.code === 'CONFLICT', 'Main側でも拒否（UIの無効化だけに頼らない）', reopen)
          assert((await task(c, ids.a)).completedAt !== null && (await task(c, ids.b)).completedAt !== null, 'タスクは完了のまま')

          // タイトル編集・プロジェクト名の編集は許可。
          // タイトルをEnterで保存した直後（保存の後処理の前）に名前の編集を始めても、保存済みのタイトルを未保存と誤認しない
          await c.setInput(titleInput, 'リリース資料（修正）')
          await c.focus(titleInput)
          await c.enter()
          await c.click(`document.querySelector('button[aria-label="プロジェクト名を変更"]')`)
          await c.waitFor(`document.querySelector('[data-testid=project-name-editor] input')`, 5000, '名前の編集を開始')
          assert(!(await c.evaluate(`!!document.querySelector('[role=dialog]')`)), '保存直後の編集開始で確認ダイアログを出さない')
          assert((await task(c, ids.a)).title === 'リリース資料（修正）', 'タイトルを保存')
          await c.setInput('[data-testid=project-name-editor] input', 'リリース（完了後に改名）')
          await c.focus('[data-testid=project-name-editor] input')
          await c.enter()
          await c.waitFor(`document.querySelector('[data-testid=project-name]')?.textContent === 'リリース（完了後に改名）'`, 5000, '名前の保存')
          assert((await project(c, ids.p)).completedAt !== null, '改名しても完了のまま')

          // 取り消し: 表示フィルター（完了）はそのまま、一覧も突然空にならない。区分は未完了へ戻り、選択を維持
          await clickCompletion(c)
          await c.waitFor(`document.querySelector('[data-testid=project-status]')?.textContent === '未完了'`, 5000, '取り消しの確定表示')
          assert((await project(c, ids.p)).completedAt === null, '取り消し')
          assert(await pressed(c, 'completed'), '取り消してもフィルターは変えない')
          assert((await listIds(c)).length === 3, '一覧は変わらない')
          const back = await sectionOf(c, ids.p)
          assert(back.section === 'project-section-open' && back.current === 'page', '未完了の区分へ戻り、選択を維持', back)
          // プロジェクトを未完了に戻した後は、所属タスクを未完了に戻せる
          await c.focus('[data-testid=task-list]')
          await c.key('Home', 36)
          await c.space()
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.filter((t) => t.projectId === ${JSON.stringify(ids.p)} && t.completedAt === null).length === 1)()`, 5000, '未完了に戻す')
          // 最後は完了状態にしておく（再起動後の復元の確認用）
          const reopened = (await api(c, 'window.gtd.tasks.list()')).find((t) => t.projectId === ids.p && t.completedAt === null)
          await api(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(reopened.id)}, completed: true })`)
          await reload(c)
          await openProject(c, ids.p)
          await clickCompletion(c)
          await c.waitFor(`document.querySelector('[data-testid=project-status]')?.textContent.startsWith('完了済み')`, 5000, '再度の完了')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      '完了操作と未保存の編集: プロジェクト名（キャンセル・保存・保存失敗）、タスクのタイトル（破棄）。確認ダイアログは重ねない',
      () =>
        withApp({ label: 'completion-draft', userDataDir: dir }, async (app) => {
          const c = app.cdp
          ids.r = (await api(c, `window.gtd.projects.create({ name: 'ドラフト確認' })`)).id
          await reload(c)
          await openProject(c, ids.r)
          const dialogCount = () => c.evaluate(`document.querySelectorAll('[role=dialog]').length`)

          // 名前を編集中に完了 → キャンセル: 完了しない・入力を保持
          await c.click(`document.querySelector('button[aria-label="プロジェクト名を変更"]')`)
          await c.setInput('[data-testid=project-name-editor] input', 'ドラフト確認2')
          await clickCompletion(c)
          await c.waitFor(`document.querySelector('[role=dialog]')?.innerText.includes('プロジェクト名の変更を保存しますか')`, 3000, '名前の確認')
          assert((await dialogCount()) === 1, '確認ダイアログは1つだけ')
          await c.click(c.byText('[role=dialog] button', 'キャンセル'))
          await sleep(400)
          assert((await project(c, ids.r)).completedAt === null, 'キャンセルなら完了しない')
          assert((await c.evaluate(`document.querySelector('[data-testid=project-name-editor] input')?.value`)) === 'ドラフト確認2', '入力を保持')

          // 保存失敗（空白の名前）: 完了しない・入力を保持
          await c.setInput('[data-testid=project-name-editor] input', '   ')
          await clickCompletion(c)
          await c.waitFor(`document.querySelector('[role=dialog]')`, 3000, '名前の確認（空白）')
          await c.click(c.byText('[role=dialog] button', '保存'))
          await sleep(800)
          assert((await project(c, ids.r)).completedAt === null, '名前の保存に失敗したら完了しない')
          assert((await c.evaluate(`document.querySelector('[data-testid=project-name-editor] input')?.value`)) === '   ', '入力を保持')
          assert((await dialogCount()) === 0, 'ダイアログは閉じる')

          // 保存: 名前を保存してから完了
          await c.setInput('[data-testid=project-name-editor] input', 'ドラフト確認2')
          await clickCompletion(c)
          await c.waitFor(`document.querySelector('[role=dialog]')`, 3000, '名前の確認（保存）')
          await c.click(c.byText('[role=dialog] button', '保存'))
          await c.waitFor(`document.querySelector('[data-testid=project-status]')?.textContent.startsWith('完了済み')`, 5000, '保存後に完了')
          const saved = await project(c, ids.r)
          assert(saved.name === 'ドラフト確認2' && saved.completedAt !== null, '名前の保存と完了の両方', saved)

          // タスクのタイトルを編集中に取り消し → 破棄 → 取り消しを続行（タイトルは保存しない）
          await clickCompletion(c) // 未完了に戻す（ドラフトなし）
          await c.waitFor(`document.querySelector('[data-testid=project-status]')?.textContent === '未完了'`, 5000, '取り消し')
          await c.focus('input[aria-label="タスクのタイトル"]')
          await c.insertText('Rのタスク')
          await c.enter()
          await c.waitFor(`document.querySelectorAll('[data-testid=task-list] [role=option]').length === 1`, 5000, '追加')
          ids.rTask = (await api(c, 'window.gtd.tasks.list()')).find((t) => t.title === 'Rのタスク').id
          await c.click(`document.querySelector('[data-testid=task-list] [role=option]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, '詳細')
          await c.setInput(titleInput, 'Rのタスク（未保存）')
          await clickCompletion(c)
          await c.waitFor(`document.querySelector('[role=dialog]')?.innerText.includes('タスクのタイトルの変更を保存しますか')`, 3000, 'タイトルの確認')
          await c.click(c.byText('[role=dialog] button', '破棄'))
          await c.waitFor(`document.querySelector('[data-testid=project-completion-error]')`, 5000, '破棄後に完了を要求 → 未完了タスクで拒否')
          assert((await task(c, ids.rTask)).title === 'Rのタスク', '破棄したタイトルは保存しない')
          assert((await project(c, ids.r)).completedAt === null, '未完了タスクがあるため完了しない')

          // 名前の保存と完了の同時要求: 同じプロジェクトの更新は順番に実行され、どちらの新しい値も失わない
          await api(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(ids.rTask)}, completed: true })`)
          await c.click(`document.querySelector('button[aria-label="プロジェクト名を変更"]')`)
          await c.setInput('[data-testid=project-name-editor] input', 'ドラフト確認3')
          await c.evaluate(`(() => {
            document.querySelector('[data-testid=project-name-editor]').requestSubmit()
            document.querySelector('[data-testid=project-completion-button]').click()
          })()`)
          // 名前の保存が終わる前に確認が出た場合は「保存」を選ぶ（保存済みなら続行される）
          for (let i = 0; i < 30; i++) {
            if (await c.evaluate(`!!document.querySelector('[role=dialog]')`)) await c.click(c.byText('[role=dialog] button', '保存'))
            const current = await project(c, ids.r)
            if (current.name === 'ドラフト確認3' && current.completedAt !== null) break
            await sleep(200)
          }
          const both = await project(c, ids.r)
          assert(both.name === 'ドラフト確認3' && both.completedAt !== null, '名前と完了の両方を保存', both)
          await sleep(300)
          const view = await c.evaluate(`({ name: document.querySelector('[data-testid=project-name]')?.textContent, status: document.querySelector('[data-testid=project-status]')?.textContent, sidebar: document.querySelector('[data-testid=project-section-completed] [data-project-id="${ids.r}"]')?.textContent })`)
          assert(view.name === 'ドラフト確認3' && view.status.startsWith('完了済み') && view.sidebar?.includes('ドラフト確認3'), '画面（Queryキャッシュ）も両方の新しい値', view)
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      '再起動: プロジェクトの完了状態・区分を復元する',
      () =>
        withApp({ label: 'completion-restore', userDataDir: dir }, async (app) => {
          const c = app.cdp
          await c.waitFor(`location.hash === ${JSON.stringify(`#/projects/${ids.r}`)}`, 5000, '最後の画面の復元')
          await c.waitFor(`document.querySelector('[data-testid=project-status]')?.textContent.startsWith('完了済み')`, 5000, '完了状態の表示')
          assert(await pressed(c, 'completed'), '完了済みプロジェクトは「完了」を初期表示')
          for (const id of [ids.p, ids.r]) {
            const section = await sectionOf(c, id)
            assert(section?.section === 'project-section-completed', '完了済みの区分', section)
          }
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ]
  ]
}
