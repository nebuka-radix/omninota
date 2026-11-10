// フェーズ5.2: タスクのプロジェクト所属とプロジェクト内タスク表示のUIシナリオ。
// run.mjs から呼ぶ。すべて専用の一時userData（root配下）だけを使う。
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { assert, createDatabaseAt, openDatabaseReadOnly, requestQuit, sleep } from './lib.mjs'

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })

export function taskProjectScenarios({ withApp, root }) {
  const migrationDir = join(root, 'userData-migration')
  const scopeDir = join(root, 'userData-scope')
  const bulkDir = join(root, 'userData-bulk')
  const ids = {}

  // 画面操作の補助
  const api = (c, expression) => c.evaluate(`(${expression}).then((r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data })`)
  const apiRaw = (c, expression) => c.evaluate(expression)
  const tasksById = async (c) => new Map((await api(c, 'window.gtd.tasks.list()')).map((task) => [task.id, task]))
  const openProject = async (c, projectId) => {
    if (!(await c.evaluate(`!!document.querySelector('[data-testid=project-list]')`))) {
      await c.click(`document.querySelector('nav button[aria-label="Projects"]')`)
      await c.waitFor(`document.querySelector('[data-testid=project-list]')`, 5000, 'プロジェクト一覧')
    }
    await c.click(`[...document.querySelectorAll('[data-testid=project-list] [data-project-id]')].find((e) => e.dataset.projectId === ${JSON.stringify(projectId)})`)
    await c.waitFor(`location.hash === ${JSON.stringify(`#/projects/${projectId}`)}`, 5000, 'プロジェクトを開く')
  }
  const openInbox = async (c) => {
    await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
    await c.waitFor(`location.hash === '#/inbox'`, 5000, 'Inboxを開く')
  }
  const listIds = (c) => c.evaluate(`[...document.querySelectorAll('[data-testid=task-list] [role=option]')].map((e) => e.dataset.taskId)`)
  const countText = (c) => c.evaluate(`document.querySelector('[data-testid=task-count]')?.textContent`)
  const addTask = async (c, title) => {
    await c.focus('input[aria-label="タスクのタイトル"]')
    await c.insertText(title)
    await c.enter()
  }
  const selectRow = async (c, taskId) => {
    await c.click(`document.querySelector(${JSON.stringify(`[data-testid=task-list] [data-task-id="${taskId}"]`)})`)
    await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, '詳細の表示')
  }
  const chooseProject = (c, value) =>
    c.evaluate(
      `(() => { const s = document.querySelector('[data-testid=task-project-select]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event('change', { bubbles: true })); })()`
    )
  const selectState = (c) =>
    c.evaluate(`(() => { const s = document.querySelector('[data-testid=task-project-select]'); return s ? { value: s.value, label: s.selectedOptions[0]?.textContent, disabled: s.disabled, options: [...s.options].map((o) => ({ value: o.value, label: o.textContent, disabled: o.disabled })) } : null })()`)
  const titleDraft = (c) => c.evaluate(`document.querySelector('[data-testid=task-editor] input:not([type=hidden])')?.value`)
  const setTitleDraft = (c, value) => c.setInput('[data-testid=task-editor] input:not([type=hidden])', value)

  return [
    [
      '移行（5.1 → 5.2）: 既存のタスク・プロジェクト・Workspace設定を保持し、既存タスクは未所属',
      async () => {
        const dbFile = join(migrationDir, 'gtd.sqlite')
        const old = await createDatabaseAt(dbFile, 4) // 0000〜0003（フェーズ5.1まで）
        const projectId = randomUUID()
        const taskIds = [randomUUID(), randomUUID()]
        old.prepare('INSERT INTO projects (id, name, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, NULL)').run(
          projectId, '移行前のプロジェクト', '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z')
        const insertTask = old.prepare('INSERT INTO tasks (id, title, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?)')
        insertTask.run(taskIds[0], '移行前の未完了', '2026-11-09T01:00:00.000Z', '2026-11-09T01:00:00.000Z', null)
        insertTask.run(taskIds[1], '移行前の完了', '2026-11-09T02:00:00.000Z', '2026-11-09T03:00:00.000Z', '2026-11-09T03:00:00.000Z')
        const workspace = { version: 1, sidebarWidth: 250, detailWidth: 330, detailVisible: true, lastRoute: `/projects/${projectId}` }
        old.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run('workspace', JSON.stringify(workspace), '2026-11-09T04:00:00.000Z')
        const before = old.prepare('SELECT id, title, created_at, updated_at, completed_at FROM tasks ORDER BY id').all()
        old.close()

        await withApp({ label: 'migration', userDataDir: migrationDir }, async (app) => {
          const c = app.cdp
          assert(app.logs.some((line) => line.includes('migrations applied: 4 -> 5')), '0004だけを適用する', app.logs.filter((l) => l.includes('[db]')))
          await c.waitFor(`location.hash === ${JSON.stringify(`#/projects/${projectId}`)}`, 5000, '保存済みの画面（プロジェクト）を復元')
          const settings = await api(c, 'window.gtd.workspace.get()')
          assert(JSON.stringify(settings) === JSON.stringify(workspace), 'Workspace設定を保持', settings)
          const tasks = await api(c, 'window.gtd.tasks.list()')
          assert(tasks.every((task) => task.projectId === null), '既存タスクは未所属', tasks)
          await c.waitFor(`document.querySelector('[data-testid=project-name]')?.textContent === '移行前のプロジェクト'`, 5000, 'プロジェクト名の表示')
          assert(
            (await c.evaluate(`document.querySelector('[data-testid=task-add-target]')?.textContent`)) === '「移行前のプロジェクト」に追加',
            'プロジェクト画面に追加欄を表示'
          )
          await openInbox(c)
          await c.click(c.byText('button', 'すべて'))
          const shown = (await listIds(c)).sort()
          assert(JSON.stringify(shown) === JSON.stringify([...taskIds].sort()), 'Inboxに既存タスク（未所属）を表示', shown)
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
        const db = openDatabaseReadOnly(dbFile)
        try {
          const after = db.prepare('SELECT id, title, created_at, updated_at, completed_at, project_id FROM tasks ORDER BY id').all()
          assert(JSON.stringify(after) === JSON.stringify(before.map((row) => ({ ...row, project_id: null }))), 'タスクのID・タイトル・日時を保持', after)
          assert(db.prepare('SELECT COUNT(*) AS c FROM projects').get().c === 1, 'プロジェクトを保持')
        } finally {
          db.close()
        }
      }
    ],
    [
      'Inbox・プロジェクトの表示範囲、作成時の所属、所属変更とタイトルのドラフト、同名の判別',
      () =>
        withApp({ label: 'scope', userDataDir: scopeDir }, async (app) => {
          const c = app.cdp
          // 準備（APIで作成）: 同名のプロジェクト2つ、別のプロジェクト1つ、未所属タスク1件、移動検証用の所属タスク
          ids.work1 = (await api(c, `window.gtd.projects.create({ name: '仕事' })`)).id
          ids.work2 = (await api(c, `window.gtd.projects.create({ name: '仕事' })`)).id
          ids.home = (await api(c, `window.gtd.projects.create({ name: '家' })`)).id
          ids.later = (await api(c, `window.gtd.projects.create({ name: 'あとで完了' })`)).id
          ids.inboxTask = (await api(c, `window.gtd.tasks.create({ title: '受信したタスク' })`)).id
          ids.homeTask = (await api(c, `window.gtd.tasks.create({ title: '家のタスク', projectId: ${JSON.stringify(ids.home)} })`)).id
          await c.evaluate('location.reload()')
          await c.waitFor(`document.querySelector('nav button[aria-label="Inbox"]')`, 10000, '再読み込み')
          await sleep(500)

          // プロジェクト画面: 追加先の明示、作成時の所属、範囲の絞り込み
          await openProject(c, ids.work1)
          const target = await c.evaluate(`document.querySelector('[data-testid=task-add-target]')?.textContent`)
          assert(target === '「仕事」に追加', '追加欄に追加先を表示', target)
          await addTask(c, '仕事1のタスク')
          await c.waitFor(`document.querySelectorAll('[data-testid=task-list] [role=option]').length === 1`, 5000, 'プロジェクトの一覧に追加')
          const all = await tasksById(c)
          ids.work1Task = [...all.values()].find((task) => task.title === '仕事1のタスク').id
          assert(all.get(ids.work1Task).projectId === ids.work1, 'プロジェクト画面で追加したタスクはそのプロジェクトに所属')
          assert(JSON.stringify(await listIds(c)) === JSON.stringify([ids.work1Task]), 'プロジェクトの一覧はそのプロジェクトのタスクだけ')
          assert((await countText(c)) === '1 件表示 / 全 1 件', '件数はプロジェクト内', await countText(c))

          // Inbox: 未所属だけ。追加は未所属
          await openInbox(c)
          const description = await c.evaluate(`document.querySelector('[data-testid=scope-description]')?.textContent`)
          assert(description === 'プロジェクトに属さないタスク', 'Inboxの説明', description)
          assert(JSON.stringify(await listIds(c)) === JSON.stringify([ids.inboxTask]), 'Inboxは未所属のタスクだけ', await listIds(c))
          await addTask(c, 'Inboxで追加')
          await c.waitFor(`document.querySelectorAll('[data-testid=task-list] [role=option]').length === 2`, 5000, 'Inboxに追加')
          const added = [...(await tasksById(c)).values()].find((task) => task.title === 'Inboxで追加')
          assert(added.projectId === null, 'Inboxで追加したタスクは未所属', added)

          // 詳細の所属選択: 同名の判別、現在値
          await selectRow(c, ids.inboxTask)
          const options = await selectState(c)
          assert(options.value === '' && options.label === '未所属（Inbox）', '未所属の表示', options)
          const workLabels = options.options.filter((o) => o.value === ids.work1 || o.value === ids.work2).map((o) => o.label)
          assert(workLabels.length === 2 && workLabels[0] !== workLabels[1] && workLabels.every((l) => l.includes('ID ')), '同名プロジェクトを判別できる', workLabels)

          // タイトルのドラフトを残したまま所属を変更 → ドラフトは上書きされない。一覧から外れても詳細を表示
          await setTitleDraft(c, '受信したタスク（ドラフト）')
          await chooseProject(c, ids.home)
          await c.waitFor(`(async () => { const r = await window.gtd.tasks.list(); return r.data.find((t) => t.id === ${JSON.stringify(ids.inboxTask)}).projectId === ${JSON.stringify(ids.home)} })()`, 5000, '所属の保存')
          await sleep(300)
          assert((await titleDraft(c)) === '受信したタスク（ドラフト）', '所属変更でタイトルのドラフトを上書きしない', await titleDraft(c))
          assert((await tasksById(c)).get(ids.inboxTask).title === '受信したタスク', 'ドラフトは保存されていない')
          assert(!(await listIds(c)).includes(ids.inboxTask), 'Inboxの一覧から外れる')
          assert(await c.evaluate(`!!document.querySelector('[data-testid=selected-out-of-scope]') && !!document.querySelector('[data-testid=detail-out-of-scope]')`), '一覧の対象外であることを表示')
          assert((await selectState(c)).value === ids.home, '詳細の所属は保存後の値')

          // タイトルを保存しても、所属を古い値で上書きしない
          await c.focus('[data-testid=task-editor] input:not([type=hidden])')
          await c.enter()
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.find((t) => t.id === ${JSON.stringify(ids.inboxTask)}).title === '受信したタスク（ドラフト）')()`, 5000, 'タイトルの保存')
          const afterTitle = (await tasksById(c)).get(ids.inboxTask)
          assert(afterTitle.projectId === ids.home, 'タイトル保存後も所属は新しい値', afterTitle)
          assert((await selectState(c)).value === ids.home, '画面の所属も新しい値のまま')

          // 所属の変更とタイトルの保存を同時に要求する（再描画で保存ボタンが無効になる前）。
          // 同じタスクの更新は順番に実行されるため、両方が反映され、互いの新しい値を古い値で上書きしない
          await setTitleDraft(c, '同時操作のドラフト')
          await c.evaluate(`(() => {
            const s = document.querySelector('[data-testid=task-project-select]')
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(ids.work2)})
            s.dispatchEvent(new Event('change', { bubbles: true }))
            document.querySelector('[data-testid=task-editor] form').requestSubmit()
          })()`)
          await c.waitFor(`(async () => { const t = (await window.gtd.tasks.list()).data.find((t) => t.id === ${JSON.stringify(ids.inboxTask)}); return t.projectId === ${JSON.stringify(ids.work2)} && t.title === '同時操作のドラフト' })()`, 5000, '所属とタイトルの両方を保存')
          await sleep(300)
          const concurrent = await c.evaluate(`({ select: document.querySelector('[data-testid=task-project-select]').value, draft: document.querySelector('[data-testid=task-editor] input:not([type=hidden])').value, helper: document.querySelector('[data-testid=task-editor] .MuiFormHelperText-root')?.textContent })`)
          assert(
            concurrent.select === ids.work2 && concurrent.draft === '同時操作のドラフト' && concurrent.helper !== '未保存の変更があります',
            '画面も両方の新しい値（所属を古い値に戻さず、タイトルも保存済み）',
            concurrent
          )

          // 所属の保存失敗（業務ルール: 画面のプロジェクト一覧を取得した後で、プロジェクトを完了済みにする）。
          // 完了は実際のAPI（フェーズ5.3の projects.setCompleted）で行う。画面のQueryキャッシュは経由しないため、
          // 画面上はまだ未完了に見え、選んだ移動先をMainが拒否する
          await setTitleDraft(c, '失敗時も残るドラフト')
          await api(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(ids.homeTask)}, completed: true })`)
          await api(c, `window.gtd.projects.setCompleted({ id: ${JSON.stringify(ids.home)}, completed: true })`)
          await chooseProject(c, ids.home)
          await c.waitFor(`document.querySelector('[data-testid=task-project-error]')`, 5000, '失敗の表示')
          const error = await c.evaluate(`document.querySelector('[data-testid=task-project-error]').textContent`)
          assert(error.includes('完了済みのプロジェクトにはタスクを追加・移動できません'), 'CONFLICTの理由を表示', error)
          assert((await selectState(c)).value === ids.work2, '失敗時は保存済みの所属表示へ戻す', await selectState(c))
          assert((await titleDraft(c)) === '失敗時も残るドラフト', '失敗してもタイトルのドラフトを保持')
          assert((await tasksById(c)).get(ids.inboxTask).projectId === ids.work2, 'DBの所属は変わらない')
          await c.click(c.byText('[data-testid=task-editor] button', '変更を取り消す'))

          // 画面を開いた後で（APIで）完了済みになったプロジェクトへの追加 → Mainが拒否し、入力を残す
          // （画面を開き直すと一覧を取り直し、追加欄は無効になる。次のシナリオで確認）
          await openProject(c, ids.later)
          await api(c, `window.gtd.projects.setCompleted({ id: ${JSON.stringify(ids.later)}, completed: true })`)
          await addTask(c, '完了済みへの追加')
          await c.waitFor(`[...document.querySelectorAll('form .MuiAlert-message')].some((e) => e.textContent.includes('完了済み'))`, 5000, '追加の失敗表示')
          const addError = await c.evaluate(`[...document.querySelectorAll('form .MuiAlert-message')].map((e) => e.textContent).join(' ')`)
          assert(addError.includes('完了済み'), '完了済みプロジェクトへの追加はMainが拒否', addError)
          assert((await c.evaluate(`document.querySelector('input[aria-label="タスクのタイトル"]').value`)) === '完了済みへの追加', '入力を残す')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      'プロジェクトの切り替え: 確認後に切り替え、検索リセット・状態は未完了・ソート維持・選択解除。キャンセルなら元のまま',
      () =>
        withApp({ label: 'switch', userDataDir: scopeDir }, async (app) => {
          const c = app.cdp
          await api(c, `window.gtd.tasks.create({ title: '仕事1の追加', projectId: ${JSON.stringify(ids.work1)} })`)
          await c.evaluate('location.reload()')
          await c.waitFor(`document.querySelector('nav button[aria-label="Inbox"]')`, 10000, '再読み込み')
          await sleep(500)
          await openProject(c, ids.work1)
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '仕事1')
          await c.click(c.byText('button', 'すべて'))
          await c.click(`document.querySelector('[aria-label^="タイトルで並べ替え"]')`)
          await selectRow(c, ids.work1Task)
          await setTitleDraft(c, '切り替え前のドラフト')
          const before = await c.evaluate(`({ search: document.querySelector('input[aria-label="タイトルで絞り込み"]').value, all: document.querySelector('button[value=all]').getAttribute('aria-pressed'), sort: document.querySelector('[aria-label^="タイトルで並べ替え"]').getAttribute('aria-pressed') })`)

          await c.click(`[...document.querySelectorAll('[data-testid=project-list] [data-project-id]')].find((e) => e.dataset.projectId === ${JSON.stringify(ids.work2)})`)
          await c.waitFor(`document.querySelector('[role=dialog]')?.innerText.includes('タスクのタイトルの変更を保存しますか')`, 3000, 'ドラフトの確認')
          await c.click(c.byText('[role=dialog] button', 'キャンセル'))
          await sleep(300)
          const cancelled = await c.evaluate(`({ hash: location.hash, search: document.querySelector('input[aria-label="タイトルで絞り込み"]').value, all: document.querySelector('button[value=all]').getAttribute('aria-pressed'), sort: document.querySelector('[aria-label^="タイトルで並べ替え"]').getAttribute('aria-pressed'), draft: document.querySelector('[data-testid=task-editor] input:not([type=hidden])')?.value })`)
          assert(
            cancelled.hash === `#/projects/${ids.work1}` && cancelled.search === before.search && cancelled.all === 'true' && cancelled.sort === before.sort && cancelled.draft === '切り替え前のドラフト',
            'キャンセルなら画面・検索・状態・ソート・選択・ドラフトを変えない',
            cancelled
          )

          await c.click(`[...document.querySelectorAll('[data-testid=project-list] [data-project-id]')].find((e) => e.dataset.projectId === ${JSON.stringify(ids.work2)})`)
          await c.waitFor(`document.querySelector('[role=dialog]')`, 3000, 'ドラフトの確認（2回目）')
          await c.click(c.byText('[role=dialog] button', '破棄'))
          await c.waitFor(`location.hash === ${JSON.stringify(`#/projects/${ids.work2}`)}`, 3000, '切り替え')
          await sleep(300)
          const switched = await c.evaluate(`({ search: document.querySelector('input[aria-label="タイトルで絞り込み"]').value, open: document.querySelector('button[value=open]').getAttribute('aria-pressed'), sort: document.querySelector('[aria-label^="タイトルで並べ替え"]').getAttribute('aria-pressed'), editor: !!document.querySelector('[data-testid=task-editor]') })`)
          assert(switched.search === '' && switched.open === 'true' && switched.sort === 'true' && !switched.editor, '検索リセット・未完了・ソート維持・選択解除', switched)
          assert((await tasksById(c)).get(ids.work1Task).title === '仕事1のタスク', '破棄したドラフトは保存しない')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      '完了済みプロジェクト: 追加を無効にして理由を表示、所属中のタスクは現在値を正しく表示し、外へ移動できる',
      () =>
        withApp({ label: 'completed-project', userDataDir: scopeDir }, async (app) => {
          const c = app.cdp
          await openProject(c, ids.home)
          const target = await c.evaluate(`({ text: document.querySelector('[data-testid=task-add-target]').textContent, disabled: document.querySelector('input[aria-label="タスクのタイトル"]').disabled })`)
          assert(target.disabled && target.text.includes('完了済みのため、タスクを追加できません'), '追加を無効にして理由を表示', target)
          const sidebar = await c.evaluate(`[...document.querySelectorAll('[data-testid=project-list] [data-project-id]')].find((e) => e.dataset.projectId === ${JSON.stringify(ids.home)}).textContent`)
          assert(sidebar.includes('完了済み'), 'サイドバーで完了済みを区別', sidebar)
          await selectRow(c, ids.homeTask)
          const current = await selectState(c)
          assert(current.value === ids.home && current.label === '家（完了済み）', '完了済みの所属を現在値として表示（空欄・未所属に見せない）', current)
          assert(!current.options.some((o) => o.value !== ids.home && o.label.includes('完了済み')), '他の完了済みは候補に出さない', current.options)
          await chooseProject(c, '')
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.find((t) => t.id === ${JSON.stringify(ids.homeTask)}).projectId === null)()`, 5000, '完了済みから未所属へ移動')
          const conflict = await apiRaw(c, `window.gtd.tasks.setProject({ id: ${JSON.stringify(ids.homeTask)}, projectId: ${JSON.stringify(ids.home)} })`)
          assert(!conflict.ok && conflict.error.code === 'CONFLICT', '完了済みへの移動はCONFLICT', conflict)
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      '大量データ（5,000件）: 所属 × 検索 × 状態 × ソートと仮想化、現在行が一覧から外れた時のフォーカス',
      async () => {
        const dbFile = join(bulkDir, 'gtd.sqlite')
        const db = await createDatabaseAt(dbFile)
        const projectA = randomUUID()
        const projectB = randomUUID()
        const insertProject = db.prepare('INSERT INTO projects (id, name, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, NULL)')
        insertProject.run(projectA, 'A', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')
        insertProject.run(projectB, 'B', '2026-11-01T00:00:01.000Z', '2026-11-01T00:00:01.000Z')
        const rows = []
        const insertTask = db.prepare('INSERT INTO tasks (id, title, created_at, updated_at, completed_at, project_id) VALUES (?, ?, ?, ?, ?, ?)')
        db.transaction(() => {
          for (let i = 0; i < 5000; i++) {
            const projectId = i % 3 === 0 ? null : i % 3 === 1 ? projectA : projectB
            const at = new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString()
            const completedAt = i % 4 === 0 ? at : null
            const title = `${i % 2 === 0 ? '報告' : '連絡'} ${i}`
            const id = randomUUID()
            insertTask.run(id, title, at, at, completedAt, projectId)
            rows.push({ id, title, createdAt: at, completedAt, projectId })
          }
        })()
        db.close()

        await withApp({ label: 'bulk', userDataDir: bulkDir }, async (app) => {
          const c = app.cdp
          const rendered = () =>
            c.evaluate(`[...document.querySelectorAll('[data-testid=task-list] [role=option]')].map((e) => ({ id: e.dataset.taskId, top: e.getBoundingClientRect().top })).sort((a, b) => a.top - b.top).map((e) => e.id)`)
          const expect = (projectId, filter) => rows.filter((row) => row.projectId === projectId).filter(filter)

          // Inbox（未所属・未完了・作成日時の降順）
          await c.waitFor(`document.querySelectorAll('[data-testid=task-list] [role=option]').length > 0`, 10000, '一覧の表示')
          const inboxOpen = expect(null, (row) => row.completedAt === null).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          const inboxAll = expect(null, () => true)
          assert((await countText(c)) === `${inboxOpen.length} 件表示 / 全 ${inboxAll.length} 件`, 'Inboxの件数', await countText(c))
          let shown = await rendered()
          assert(shown.length > 0 && shown.length < 80, '描画する行は一部だけ（仮想化）', shown.length)
          assert(JSON.stringify(shown.slice(0, 5)) === JSON.stringify(inboxOpen.slice(0, 5).map((row) => row.id)), '先頭の行が期待どおり', shown.slice(0, 5))

          // プロジェクトA × 検索「報告」× 完了 × タイトル昇順
          await c.click(`document.querySelector('nav button[aria-label="Projects"]')`)
          await c.waitFor(`document.querySelector('[data-testid=project-list]')`, 5000, 'プロジェクト一覧')
          await c.click(`[...document.querySelectorAll('[data-testid=project-list] [data-project-id]')].find((e) => e.dataset.projectId === ${JSON.stringify(projectA)})`)
          await c.waitFor(`document.querySelectorAll('[data-testid=task-list] [role=option]').length > 0`, 10000, 'プロジェクトAの一覧')
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '報告')
          await c.click(c.byText('button', '完了'))
          await c.click(`document.querySelector('[aria-label^="タイトルで並べ替え"]')`)
          await sleep(400)
          const filtered = expect(projectA, (row) => row.completedAt !== null && row.title.includes('報告')).sort((a, b) => collator.compare(a.title, b.title))
          assert((await countText(c)) === `${filtered.length} 件表示 / 全 ${expect(projectA, () => true).length} 件`, '組み合わせた件数', await countText(c))
          shown = await rendered()
          assert(shown.length < 80, '描画行数', shown.length)
          assert(JSON.stringify(shown.slice(0, 10)) === JSON.stringify(filtered.slice(0, 10).map((row) => row.id)), '絞り込み・ソート後の先頭の行', shown.slice(0, 10))

          // 末尾までスクロールして対象IDを確認
          await c.focus('[data-testid=task-list]')
          await c.key('End', 35)
          await sleep(400)
          shown = await rendered()
          assert(shown.at(-1) === filtered.at(-1).id, '末尾の行', { last: shown.at(-1), expected: filtered.at(-1).id })
          const allInScope = shown.every((id) => filtered.some((row) => row.id === id))
          assert(allInScope, '描画中の行はすべて条件に一致する')

          // 現在行（末尾）を未完了に戻す → 「完了」の一覧から外れる → フォーカスは一覧に残り、現在行は描画済みの行へ移る
          await c.space()
          await sleep(600)
          const focus = await c.evaluate(`(() => { const list = document.querySelector('[data-testid=task-list]'); const id = list.getAttribute('aria-activedescendant'); const active = id ? document.getElementById(id) : null; const r = active?.getBoundingClientRect(); const v = document.querySelector('[data-testid=task-list-scroll]').getBoundingClientRect(); return { focused: document.activeElement === list, activeId: active?.dataset.taskId ?? null, inView: !!r && r.top >= v.top - 1 && r.bottom <= v.bottom + 1 } })()`)
          assert(focus.focused && focus.activeId === filtered.at(-2).id && focus.inView, '現在行が外れたら同じ位置の行を現在行にし、フォーカスを保つ', focus)
          assert((await countText(c)) === `${filtered.length - 1} 件表示 / 全 ${expect(projectA, () => true).length} 件`, '件数の更新')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
      }
    ]
  ]
}
