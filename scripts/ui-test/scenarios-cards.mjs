// フェーズ5.5: 左サイドバー（Inboxのバッジ・Project・NEW PROJECT）、新規プロジェクトの作成、右サイドバーのプロジェクト詳細、
// マイルストン別カード（NEW MILESTONE・NEW TASK・共通の幅と保存）のUIシナリオ。run.mjs から呼ぶ。
// すべて専用の一時userData（root配下）だけを使う。準備はPreloadの用途別APIで行い、DBを直接変更するのは事前データの用意と、
// 作成失敗を起こすための一時的な書き込みロック（テスト用DBだけ）に限る。
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { goToProject, assert, closeInlineCreate, createDatabaseAt, firstMilestoneId, openDatabaseReadOnly, PROJECT_ROOT, requestQuit, sleep } from './lib.mjs'

const require = createRequire(join(PROJECT_ROOT, 'package.json'))

export function cardScenarios({ withApp, root }) {
  const dir = join(root, 'userData-cards')
  const bulkDir = join(root, 'userData-cards-bulk')
  const dbFile = join(dir, 'gtd.sqlite')
  const ids = {}

  const api = (c, expression) =>
    c.evaluate(`(${expression}).then((r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data })`)
  const projects = (c) => api(c, 'window.gtd.projects.list()')
  const tasks = (c) => api(c, 'window.gtd.tasks.list()')
  const task = async (c, id) => (await tasks(c)).find((t) => t.id === id)
  const reload = async (c) => {
    await c.evaluate('location.reload()')
    await c.waitFor(`document.querySelector('nav button[aria-label="Inbox"]')`, 10000, '再読み込み')
    await sleep(500)
  }
  const openInbox = async (c) => {
    await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
    await c.waitFor(`location.hash === '#/inbox'`, 5000, 'Inbox')
  }
  const openProject = async (c, projectId) => {
    await goToProject(c, projectId)
    await c.waitFor(`location.hash === ${JSON.stringify(`#/projects/${projectId}`)}`, 5000, 'プロジェクトを開く')
    await c.waitFor(`document.querySelector('[data-testid=milestone-board]')`, 5000, 'カードの表示')
    await sleep(200)
  }
  const dialogText = (c) => c.evaluate(`document.querySelector('[role=dialog]')?.innerText ?? null`)
  const badge = (c) =>
    c.evaluate(`(() => { const b = document.querySelector('nav button[aria-label="Inbox"]'); const id = b.getAttribute('aria-describedby'); return { text: document.querySelector('[data-testid=nav-inbox-badge]')?.textContent ?? null, inButton: !!b.querySelector('[data-testid=nav-inbox-badge]'), description: id ? document.getElementById(id)?.textContent : null, buttonsInNav: b.querySelectorAll('button').length } })()`)
  // カード（表示順）: キー・見出し・件数・描画中のタスクID
  const cards = (c) =>
    c.evaluate(`[...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => ({
      key: e.dataset.cardKey,
      label: e.querySelector('[data-testid=group-label]')?.textContent ?? null,
      count: e.querySelector('[data-testid=card-count]')?.textContent ?? null,
      width: Math.round(e.getBoundingClientRect().width),
      left: Math.round(e.getBoundingClientRect().left),
      tasks: [...e.querySelectorAll('[role=option]')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((o) => o.dataset.taskId)
    }))`)
  const newTaskSel = (milestoneId) => `[data-testid="new-task-${milestoneId}"]`
  const openNewTask = async (c, milestoneId) => {
    await c.click(`document.querySelector('${newTaskSel(milestoneId)} button')`)
    await c.waitFor(`document.activeElement === document.querySelector('${newTaskSel(milestoneId)} input')`, 3000, 'NEW TASK の入力欄へフォーカス')
  }
  const workspace = (c) => api(c, 'window.gtd.workspace.get()')

  return [
    [
      '左サイドバー: Inboxのバッジ（0件も表示・件数更新・読み上げ）、Project の表示名、旧登録欄なし、NEW PROJECT は最下段（0件でも）・キーボードで開ける',
      async () => {
        // 既存の左右の幅の設定（変更されないことを最後に確認する）
        const db = await createDatabaseAt(dbFile)
        db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run(
          'workspace',
          JSON.stringify({ version: 1, sidebarWidth: 260, detailWidth: 340, detailVisible: true, lastRoute: '/inbox' }),
          '2026-11-10T00:00:00.000Z'
        )
        db.close()
        await withApp({ label: 'nav-55', userDataDir: dir }, async (app) => {
          const c = app.cdp
          let b = await badge(c)
          assert(b.text === '0' && b.inButton && b.buttonsInNav === 0 && b.description === '未完了のタスク 0 件', '0件もバッジに0を表示（Inboxのボタンの一部・別の操作対象にしない）・読み上げの説明', b)
          const navText = await c.evaluate(`document.querySelector('nav[aria-label="ナビゲーション"]').innerText`)
          assert(!navText.includes('未完了 0') && !/未完了\s*\d/.test(navText), '「未完了」の項目名ラベルは表示しない', navText)
          const nav = await c.evaluate(`({
            labels: [...document.querySelectorAll('nav[aria-label="ナビゲーション"] button[aria-label]')].map((e) => e.getAttribute('aria-label')),
            oldInput: !!document.querySelector('input[aria-label="新しいプロジェクトの名前"]'),
            oldPlus: !!document.querySelector('button[aria-label="プロジェクトを作成"]'),
            newProject: document.querySelector('[data-testid=new-project]')?.textContent ?? null,
            empty: document.querySelector('#navigation-projects')?.innerText ?? ''
          })`)
          assert(nav.labels.includes('Project') && !nav.labels.includes('Projects'), '表示名は Project', nav)
          assert(!nav.oldInput && !nav.oldPlus, 'サイドバーの名前入力欄と＋ボタンはない', nav)
          assert(nav.newProject === 'NEW PROJECT' && nav.empty.includes('プロジェクトはまだありません'), 'プロジェクト0件でも NEW PROJECT を表示', nav)

          // 件数の更新: Inboxに追加 → 1、完了 → 0、もう1件追加 → 1
          const t1 = (await api(c, `window.gtd.tasks.create({ title: 'バッジ1' })`)).id
          await reload(c)
          b = await badge(c)
          assert(b.text === '1' && b.description === '未完了のタスク 1 件', '追加で1', b)
          await openInbox(c)
          await c.focus('[data-testid=task-list]')
          await c.key('Home', 36)
          await c.space()
          await c.waitFor(`document.querySelector('[data-testid=nav-inbox-badge]').textContent === '0'`, 5000, '完了で0（画面の操作で即時に更新）')
          await c.focus('input[aria-label="タスクのタイトル"]')
          await c.insertText('バッジ2')
          await c.enter()
          await c.waitFor(`document.querySelector('[data-testid=nav-inbox-badge]').textContent === '1'`, 5000, 'Inboxで追加して1')
          ids.badgeTask = (await tasks(c)).find((t) => t.title === 'バッジ2').id
          assert((await task(c, t1)).completedAt !== null, '完了した')

          // NEW PROJECT はプロジェクト一覧の後、Project配下の最後（フェーズ5.8: 区分はなく、完了済みのプロジェクトは表示しない）
          ids.a = (await api(c, `window.gtd.projects.create({ name: 'A案件' })`)).id
          ids.done = (await api(c, `window.gtd.projects.create({ name: '終わった案件' })`)).id
          await api(c, `window.gtd.projects.setCompleted({ id: ${JSON.stringify(ids.done)}, completed: true })`)
          await reload(c)
          const order = await c.evaluate(`(() => {
            const area = document.querySelector('#navigation-projects')
            const all = [...area.querySelectorAll('[data-testid=project-list], [data-testid^=project-section-], [data-testid=new-project]')]
            const np = document.querySelector('[data-testid=new-project]')
            const inList = !!np.closest('[data-testid=project-list]')
            const last = [...area.querySelectorAll('[role=button], button, [data-project-id]')].at(-1)
            const items = [...area.querySelectorAll('[data-project-id]')].map((e) => e.dataset.projectId)
            return { order: all.map((e) => e.dataset.testid), inList, isLast: last === np || np.contains(last), items }
          })()`)
          assert(
            JSON.stringify(order.order) === JSON.stringify(['project-list', 'new-project']) && !order.inList && order.isLast &&
              order.items.includes(ids.a) && !order.items.includes(ids.done),
            'NEW PROJECT は一覧の中ではなく、Project配下全体の最後（完了済みは一覧にない）',
            order
          )
          // キーボード: NEW PROJECT にフォーカスして Enter → 新規画面
          await c.focus('[data-testid=new-project]')
          await c.enter()
          await c.waitFor(`location.hash === '#/projects/new'`, 3000, 'Enter で新規画面を開く')
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=project-name-editor] input')`, 3000, '名前欄にフォーカス')
          const current = await c.evaluate(`document.querySelector('[data-testid=new-project]').getAttribute('aria-current')`)
          assert(current === 'page', 'NEW PROJECT を選択状態で示す', current)
          assert((await projects(c)).length === 2, '開いただけでは作らない')
          await c.key('Escape', 27)
          await c.waitFor(`location.hash === '#/inbox'`, 3000, 'Esc で直前の画面（Inbox）へ戻る')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
      }
    ],
    [
      '新規プロジェクト: 表示直後から編集・フォーカス、開いただけでは作らない、空名・空白・blurでは作らない、取消、二重送信、保存失敗で入力保持、成功後は選択して不要な確認なし',
      () =>
        withApp({ label: 'new-project', userDataDir: dir }, async (app) => {
          const c = app.cdp
          const input = '[data-testid=project-name-editor] input'
          const before = (await projects(c)).length
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
          await c.click(`document.querySelector('[data-testid=new-project]')`)
          await c.waitFor(`location.hash === '#/projects/new'`, 3000, '新規画面')
          await c.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(input)})`, 3000, '表示直後に名前欄へフォーカス')
          const screen = await c.evaluate(`({
            editing: !!document.querySelector('[data-testid=project-name-editor]'),
            value: document.querySelector(${JSON.stringify(input)}).value,
            note: document.querySelector('[data-testid=new-project-note]')?.textContent,
            newTask: document.querySelector('[data-testid=new-task-placeholder-button]')?.disabled,
            newMilestone: document.querySelector('[data-testid=new-milestone-button]')?.disabled,
            completion: !!document.querySelector('[data-testid=project-completion-button]'),
            status: !!document.querySelector('[data-testid=project-status]'),
            detail: document.querySelector('#detail-panel')?.innerText ?? ''
          })`)
          assert(screen.editing && screen.value === '', '最初から編集状態（空）', screen)
          assert(screen.note?.includes('先にプロジェクト名を保存') && screen.newTask === true && screen.newMilestone === true, '保存前はマイルストン・タスクの追加を無効にして理由を示す', screen)
          assert(!screen.completion && !screen.status && screen.detail.includes('プロジェクト名を保存すると'), '保存前は完了操作・状態を表示しない', screen)
          assert((await projects(c)).length === before, 'NEW PROJECT を押しただけではDBに作らない')

          // 空のまま Enter・空白だけ・blur では作らない
          await c.enter()
          await c.setInput(input, '   ')
          await c.focus(input)
          await c.enter()
          await c.setInput(input, 'blurだけ')
          await c.evaluate(`document.querySelector(${JSON.stringify(input)}).blur()`)
          await sleep(500)
          assert((await projects(c)).length === before && (await c.evaluate('location.hash')) === '#/projects/new', '空・空白・blurでは作成しない')

          // 何も入力していない新規画面からは、確認なしで移動できる
          await c.setInput(input, '')
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
          await c.waitFor(`location.hash === '#/inbox'`, 3000, '空の新規画面からは確認なしで移動')
          assert((await dialogText(c)) === null, '不要な未保存確認を出さない')

          // 入力済みの新規画面から移動 → 既存の確認（キャンセルで留まる・入力保持、破棄で移動・作らない）
          await c.click(`document.querySelector('[data-testid=new-project]')`)
          await c.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(input)})`, 3000, '新規画面（2回目）')
          await c.insertText('移動の確認')
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
          await c.waitFor(`document.querySelector('[role=dialog]')?.innerText.includes('プロジェクト名の変更を保存しますか')`, 3000, '未保存の確認')
          await c.click(c.byText('[role=dialog] button', 'キャンセル'))
          await sleep(300)
          assert((await c.evaluate('location.hash')) === '#/projects/new' && (await c.evaluate(`document.querySelector(${JSON.stringify(input)}).value`)) === '移動の確認', 'キャンセルなら留まり、入力を保持')
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
          await c.waitFor(`document.querySelector('[role=dialog]')`, 3000, '未保存の確認（2回目）')
          await c.click(c.byText('[role=dialog] button', '破棄'))
          await c.waitFor(`location.hash === '#/inbox'`, 3000, '破棄して移動')
          assert((await projects(c)).length === before, '破棄したら作らない')

          // 取消: 「キャンセル」ボタンで直前の画面（Inbox）へ戻る。DBは変わらない
          await c.click(`document.querySelector('[data-testid=new-project]')`)
          await c.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(input)})`, 3000, '新規画面（3回目）')
          await c.insertText('取り消す名前')
          await c.click(c.byText('[data-testid=project-name-editor] button', 'キャンセル'))
          await c.waitFor(`location.hash === '#/inbox'`, 3000, 'キャンセルで直前の画面へ')
          assert((await dialogText(c)) === null && (await projects(c)).length === before, 'キャンセルは確認なし・DBは変わらない')

          // 保存失敗: テスト用DBに書き込みロックをかけた状態で作成 → 失敗の理由を表示し、入力を保持。作成されない
          await c.click(`document.querySelector('[data-testid=new-project]')`)
          await c.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(input)})`, 3000, '新規画面（4回目）')
          await c.insertText('失敗する作成')
          const Database = require('better-sqlite3')
          const locker = new Database(dbFile)
          locker.exec('BEGIN IMMEDIATE')
          try {
            await c.enter()
            await c.waitFor(`document.querySelector('[data-testid=project-name-error]')`, 15000, '作成失敗の表示（ロックの待ち時間を含む）')
          } finally {
            locker.exec('ROLLBACK')
            locker.close()
          }
          const failed = await c.evaluate(`({ hash: location.hash, value: document.querySelector(${JSON.stringify(input)}).value, error: document.querySelector('[data-testid=project-name-error]').textContent })`)
          assert(failed.hash === '#/projects/new' && failed.value === '失敗する作成' && failed.error.startsWith('作成できませんでした'), '失敗時は入力を保持して理由を表示', failed)
          assert((await projects(c)).length === before, '失敗時は作成されない')

          // 二重送信: 送信を2回続けて要求しても1件だけ作る。成功後は作成したプロジェクトの画面へ移り、サイドバーで選択状態
          await c.setInput(input, '新しい案件')
          await c.evaluate(`(() => { const f = document.querySelector('[data-testid=project-name-editor]'); f.requestSubmit(); f.requestSubmit() })()`)
          await c.waitFor(`/^#\\/projects\\/[0-9a-f-]{36}$/.test(location.hash)`, 5000, '作成したプロジェクトの画面へ移る')
          await sleep(500)
          const created = (await projects(c)).filter((p) => p.name === '新しい案件')
          assert(created.length === 1 && (await projects(c)).length === before + 1, '1件だけ作成（二重送信しない）', created)
          ids.created = created[0].id
          const after = await c.evaluate(`({
            hash: location.hash,
            name: document.querySelector('[data-testid=project-name]')?.textContent,
            selected: document.querySelector('[data-testid=project-list] [aria-current=page]')?.dataset.projectId,
            dialog: document.querySelector('[role=dialog]')?.innerText ?? null,
            cards: document.querySelectorAll('[data-testid=milestone-card]').length,
            status: document.querySelector('[data-testid=project-status]')?.textContent
          })`)
          assert(
            after.hash === `#/projects/${ids.created}` && after.name === '新しい案件' && after.selected === ids.created && after.dialog === null,
            '作成したプロジェクトの編集画面・サイドバーで選択・不要な確認なし',
            after
          )
          assert(after.cards === 1 && after.status === '未完了', '作成後はカード（新しいマイルストン）と右の状態を表示', after)
          // 5.6: 作成と同時に「新しいマイルストン」が1件だけ（二重送信でも重複しない）
          const createdMilestones = (await api(c, 'window.gtd.milestones.list()')).filter((m) => m.projectId === ids.created)
          const cardLabel = await c.evaluate(`document.querySelector('[data-testid=milestone-card] [data-testid=group-label]')?.textContent`)
          assert(createdMilestones.length === 1 && createdMilestones[0].name === '新しいマイルストン' && cardLabel === '新しいマイルストン', '初期マイルストンを1件だけ作成', { createdMilestones, cardLabel })
          // 作成後の別画面への移動でも確認を出さない
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
          await c.waitFor(`location.hash === '#/inbox'`, 3000, '作成後に移動')
          assert((await dialogText(c)) === null, '作成済みの入力について確認を出さない')
          // 履歴を置き換えるため、戻っても作成前の新規画面にはならない
          await c.evaluate('history.back()')
          await sleep(500)
          assert((await c.evaluate('location.hash')) !== '#/projects/new', '戻る操作で新規画面に戻らない', await c.evaluate('location.hash'))
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      '新規プロジェクト: 名前を入力中の終了 →（指定した回答）保存して終了で作成される',
      () =>
        withApp(
          { label: 'new-project-exit', userDataDir: dir, dialogAnswers: [{ message: 'プロジェクト名に未保存の変更があります', button: '保存して終了' }] },
          async (app) => {
            const c = app.cdp
            await c.click(`document.querySelector('[data-testid=new-project]')`)
            await c.waitFor(`document.activeElement === document.querySelector('[data-testid=project-name-editor] input')`, 3000, '新規画面')
            await c.insertText('終了時に作成')
            const quit = await requestQuit(app)
            assert(quit?.code === 0, '保存して終了', quit)
            const db = openDatabaseReadOnly(dbFile)
            try {
              const rows = db.prepare('SELECT name FROM projects WHERE name = ?').all('終了時に作成')
              assert(rows.length === 1, '終了時の「保存」で作成される', rows)
            } finally {
              db.close()
            }
          }
        )
    ],
    [
      '右サイドバー: プロジェクトの状態・完了（未完了タスクがあれば拒否）・取り消し、タスク詳細との切り替え（未保存の確認つき）。メインパネルには完了操作を置かない',
      () =>
        withApp({ label: 'detail-55', userDataDir: dir }, async (app) => {
          const c = app.cdp
          ids.p = (await api(c, `window.gtd.projects.create({ name: '状態の確認' })`)).id
          ids.pt = (await api(c, `window.gtd.tasks.create({ title: '残りのタスク', projectId: ${JSON.stringify(ids.p)}, milestoneId: ${JSON.stringify(await firstMilestoneId(c, ids.p))} })`)).id
          await reload(c)
          await openProject(c, ids.p)
          const layout = await c.evaluate(`({
            inMain: !!document.querySelector('main [data-testid=project-completion-button], main [data-testid=project-status]'),
            inDetail: !!document.querySelector('#detail-panel [data-testid=project-completion-button]'),
            status: document.querySelector('#detail-panel [data-testid=project-status]')?.textContent,
            name: document.querySelector('#detail-panel [data-testid=project-detail-name]')?.textContent
          })`)
          assert(!layout.inMain && layout.inDetail && layout.status === '未完了' && layout.name === '状態の確認', '状態・完了操作は右の詳細パネルだけ', layout)

          // 未完了タスクがあれば拒否（件数と「未完了のタスクを表示」）
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '該当なし')
          await c.click(`document.querySelector('[data-testid=project-completion-button]')`)
          await c.waitFor(`document.querySelector('[data-testid=project-completion-error]')`, 5000, '拒否')
          const rejected = await c.evaluate(`document.querySelector('[data-testid=project-completion-error]').textContent`)
          assert(rejected.includes('未完了のタスクが 1 件あるため完了できません'), '件数つきで拒否', rejected)
          await c.click(`document.querySelector('[data-testid=reveal-open-tasks]')`)
          await sleep(400)
          const revealed = await c.evaluate(`({ search: document.querySelector('input[aria-label="タイトルで絞り込み"]').value, ids: [...document.querySelectorAll('[data-testid=task-list] [role=option]')].map((e) => e.dataset.taskId) })`)
          assert(revealed.search === '' && revealed.ids.includes(ids.pt), '詳細パネルから、メインパネルの未完了タスクを表示する', revealed)

          // タスクを選択 → タスク詳細（プロジェクトの完了操作は出ない）→ タイトルを編集 → 「プロジェクトの詳細」で既存の確認
          await c.click(`document.querySelector('[data-testid=task-list] [data-task-id="${ids.pt}"]')`)
          await c.waitFor(`document.querySelector('#detail-panel [data-testid=task-editor]')`, 3000, 'タスクの詳細')
          assert(!(await c.evaluate(`!!document.querySelector('[data-testid=project-completion-button]')`)), 'タスク選択時はタスクの詳細（完了操作は出さない）')
          await c.setInput('[data-testid=task-editor] input:not([type=hidden])', '残りのタスク（未保存）')
          await c.click(`document.querySelector('[data-testid=back-to-project]')`)
          await c.waitFor(`document.querySelector('[role=dialog]')?.innerText.includes('タスクのタイトルの変更を保存しますか')`, 3000, '未保存のタイトルの確認')
          await c.click(c.byText('[role=dialog] button', 'キャンセル'))
          await sleep(300)
          assert(await c.evaluate(`!!document.querySelector('[data-testid=task-editor]')`), 'キャンセルならタスクの詳細のまま')
          await c.click(`document.querySelector('[data-testid=back-to-project]')`)
          await c.waitFor(`document.querySelector('[role=dialog]')`, 3000, '確認（2回目）')
          await c.click(c.byText('[role=dialog] button', '保存'))
          await c.waitFor(`document.querySelector('#detail-panel [data-testid=project-detail]')`, 3000, 'プロジェクトの詳細へ戻る')
          assert((await task(c, ids.pt)).title === '残りのタスク（未保存）', '保存してから戻る')
          assert(!(await c.evaluate(`!!document.querySelector('[data-testid=task-list] [aria-selected=true]')`)), 'タスクの選択を解除')

          // タスクを完了 → プロジェクトを完了 → 取り消し
          await api(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(ids.pt)}, completed: true })`)
          await reload(c)
          await openProject(c, ids.p)
          await c.click(`document.querySelector('[data-testid=project-completion-button]')`)
          await c.waitFor(`document.querySelector('[data-testid=project-status]')?.textContent.startsWith('完了済み')`, 5000, '完了')
          const done = await c.evaluate(`({ button: document.querySelector('[data-testid=project-completion-button]').textContent, notice: !!document.querySelector('[data-testid=project-completed-notice]'), newTask: [...document.querySelectorAll('[data-testid$=-button][data-testid^=new-]')].map((b) => [b.dataset.testid, b.disabled]) })`)
          assert(done.button.includes('未完了に戻す') && done.notice && done.newTask.every(([, disabled]) => disabled), '完了済み: 取り消し操作を表示し、NEW TASK・NEW MILESTONE を無効化', done)
          assert((await projects(c)).find((p) => p.id === ids.p).completedAt !== null, 'DBも完了')
          await c.click(`document.querySelector('[data-testid=project-completion-button]')`)
          await c.waitFor(`document.querySelector('[data-testid=project-status]')?.textContent === '未完了'`, 5000, '取り消し')
          assert((await projects(c)).find((p) => p.id === ids.p).completedAt === null, 'DBも未完了')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      'カード: マイルストン別（作成順・空も表示・未設定のカードはない・最後に NEW MILESTONE）、旧登録欄なし、NEW MILESTONE／NEW TASK の登録先・取消・空名・失敗時の入力保持、共通の検索・状態・ソート、カード見出しから名前変更',
      () =>
        withApp({ label: 'cards', userDataDir: dir }, async (app) => {
          const c = app.cdp
          ids.cp = (await api(c, `window.gtd.projects.create({ name: 'カード確認' })`)).id
          ids.cpInitial = await firstMilestoneId(c, ids.cp)
          ids.m1 = (await api(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(ids.cp)}, name: 'M1' })`)).id
          ids.m2 = (await api(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(ids.cp)}, name: 'M2' })`)).id
          ids.c1 = (await api(c, `window.gtd.tasks.create({ title: 'b-M1のタスク', projectId: ${JSON.stringify(ids.cp)}, milestoneId: ${JSON.stringify(ids.m1)} })`)).id
          ids.c2 = (await api(c, `window.gtd.tasks.create({ title: 'a-M1のタスク', projectId: ${JSON.stringify(ids.cp)}, milestoneId: ${JSON.stringify(ids.m1)} })`)).id
          ids.c3 = (await api(c, `window.gtd.tasks.create({ title: '初期のタスク', projectId: ${JSON.stringify(ids.cp)}, milestoneId: ${JSON.stringify(ids.cpInitial)} })`)).id
          await reload(c)
          await openProject(c, ids.cp)
          const gone = await c.evaluate(`({
            milestoneInput: !!document.querySelector('[data-testid=milestone-create]') || [...document.querySelectorAll('button')].some((b) => b.textContent.includes('マイルストン登録')),
            taskInput: !!document.querySelector('main input[aria-label="タスクのタイトル"]'),
            taskLabel: !!document.querySelector('main [data-testid=task-add-target]') || !!document.querySelector('main [data-testid=task-add-disabled-reason]'),
            register: [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === '登録')
          })`)
          assert(Object.values(gone).every((v) => v === false), '旧来の常設の登録欄・ボタン・項目名ラベルはない', gone)
          let list = await cards(c)
          assert(
            JSON.stringify(list.map((x) => [x.key, x.label, x.count])) ===
              JSON.stringify([[`group:${ids.cpInitial}`, '新しいマイルストン', '1 件'], [`group:${ids.m1}`, 'M1', '2 件'], [`group:${ids.m2}`, 'M2', '0 件']]),
            'マイルストンの作成順（作成時の「新しいマイルストン」が先頭）・空のM2も表示・未設定のカードはない',
            list
          )
          assert(JSON.stringify(list[1].tasks) === JSON.stringify([ids.c2, ids.c1]) && JSON.stringify(list[0].tasks) === JSON.stringify([ids.c3]), 'カード内に所属タスクを表示（作成日時の降順）', list)
          const placement = await c.evaluate(`(() => {
            const cardsEl = [...document.querySelectorAll('[data-testid=milestone-card]')]
            const nm = document.querySelector('[data-testid=new-milestone]')
            const lastCard = cardsEl.at(-1).getBoundingClientRect()
            return { sameRow: cardsEl.every((e) => Math.abs(e.getBoundingClientRect().top - cardsEl[0].getBoundingClientRect().top) < 2), afterLast: nm.getBoundingClientRect().left >= lastCard.right - 1 }
          })()`)
          assert(placement.sameRow && placement.afterLast, 'カードは横並び、NEW MILESTONE は最後のカードの後', placement)

          // NEW MILESTONE: 取消（Esc）・空名では作らない・登録（Enter）
          const milestoneCount = async () => (await api(c, 'window.gtd.milestones.list()')).filter((m) => m.projectId === ids.cp).length
          await c.click(`document.querySelector('[data-testid=new-milestone-button]')`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=new-milestone] input')`, 3000, 'インライン入力')
          await c.insertText('取り消すM')
          await c.key('Escape', 27)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=new-milestone-button]')`, 3000, 'Escで閉じてボタンへフォーカス')
          assert((await milestoneCount()) === 3, 'Escでは作らない')
          await c.click(`document.querySelector('[data-testid=new-milestone-button]')`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=new-milestone] input')`, 3000, 'インライン入力（2回目）')
          await c.insertText('   ')
          await c.enter()
          await sleep(300)
          assert((await milestoneCount()) === 3 && (await c.evaluate(`document.querySelector('[data-testid=new-milestone] button[type=submit]').disabled`)), '空白だけでは作らない（保存ボタンも無効）')
          await c.click(c.byText('[data-testid=new-milestone] button', 'キャンセル'))
          await c.click(`document.querySelector('[data-testid=new-milestone-button]')`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=new-milestone] input')`, 3000, 'インライン入力（3回目）')
          await c.insertText('M3')
          await c.enter()
          await c.waitFor(`[...document.querySelectorAll('[data-testid=group-label]')].some((e) => e.textContent === 'M3')`, 5000, 'M3のカード')
          ids.m3 = (await api(c, 'window.gtd.milestones.list()')).find((m) => m.name === 'M3').id
          list = await cards(c)
          assert(list.map((x) => x.key).join() === [`group:${ids.cpInitial}`, `group:${ids.m1}`, `group:${ids.m2}`, `group:${ids.m3}`].join(), '新しいカードは最後（作成順）', list.map((x) => x.key))

          // NEW TASK: カードごとの登録先。M2で入力を始め、途中で別カード（M1）のタスクを選んでも、登録先はM2のまま
          await openNewTask(c, ids.m2)
          await c.insertText('M2に入るタスク')
          await c.click(`document.querySelector('[data-testid=task-list] [data-task-id="${ids.c1}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, '別カードのタスクを選択')
          await c.focus(`${newTaskSel(ids.m2)} input`)
          await c.enter()
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.some((t) => t.title === 'M2に入るタスク'))()`, 5000, 'M2に登録')
          const m2Task = (await tasks(c)).find((t) => t.title === 'M2に入るタスク')
          assert(m2Task.projectId === ids.cp && m2Task.milestoneId === ids.m2, 'マイルストンのカードは projectId と milestoneId を指定（最後に選んだ別カードを引き継がない）', m2Task)
          await c.waitFor(`document.activeElement === document.querySelector('${newTaskSel(ids.m2)} input') && document.activeElement.value === ''`, 3000, '登録後は入力欄を空にして続けて入力できる')
          await closeInlineCreate(c, `new-task-${ids.m2}`)
          // 初期マイルストンのカード: 保存ボタンでも登録できる
          await openNewTask(c, ids.cpInitial)
          await c.insertText('初期に入るタスク')
          await c.click(c.byText(`${newTaskSel(ids.cpInitial)} button`, '追加'))
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.some((t) => t.title === '初期に入るタスク'))()`, 5000, '初期マイルストンに登録')
          const initialTask = (await tasks(c)).find((t) => t.title === '初期に入るタスク')
          assert(initialTask.projectId === ids.cp && initialTask.milestoneId === ids.cpInitial, 'カードのマイルストンに所属', initialTask)
          // 取消・空名
          await closeInlineCreate(c, `new-task-${ids.cpInitial}`)
          await openNewTask(c, ids.m1)
          await c.insertText('取り消すタスク')
          await c.key('Escape', 27)
          await c.waitFor(`!document.querySelector('${newTaskSel(ids.m1)} input')`, 3000, 'Escで閉じる')
          await openNewTask(c, ids.m1)
          await c.enter()
          await sleep(300)
          assert(!(await tasks(c)).some((t) => t.title === '取り消すタスク' || t.title === ''), '取消・空名では作らない')
          await c.click(c.byText(`${newTaskSel(ids.m1)} button`, 'キャンセル'))

          // 失敗時の入力保持（画面を開いた後で、APIでプロジェクトを完了済みにする → Mainが拒否）
          ids.failProject = (await api(c, `window.gtd.projects.create({ name: '失敗確認' })`)).id
          ids.failMilestone = (await api(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(ids.failProject)}, name: 'FM' })`)).id
          await reload(c)
          await openProject(c, ids.failProject)
          await openNewTask(c, ids.failMilestone)
          await c.insertText('拒否されるタスク')
          await c.click(`document.querySelector('[data-testid=new-milestone-button]')`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=new-milestone] input')`, 3000, 'NEW MILESTONE の入力へフォーカス')
          await c.insertText('拒否されるM')
          await api(c, `window.gtd.projects.setCompleted({ id: ${JSON.stringify(ids.failProject)}, completed: true })`)
          await c.enter()
          await c.waitFor(`document.querySelector('[data-testid=new-milestone-error]')`, 5000, 'マイルストン登録の失敗表示')
          await c.focus(`${newTaskSel(ids.failMilestone)} input`)
          await c.enter()
          await c.waitFor(`document.querySelector('[data-testid="new-task-${ids.failMilestone}-error"]')`, 5000, 'タスク登録の失敗表示')
          const kept = await c.evaluate(`({
            m: document.querySelector('[data-testid=new-milestone] input').value,
            t: document.querySelector('${newTaskSel(ids.failMilestone)} input').value,
            mError: document.querySelector('[data-testid=new-milestone-error]').textContent,
            tError: document.querySelector('[data-testid="new-task-${ids.failMilestone}-error"]').textContent
          })`)
          assert(kept.m === '拒否されるM' && kept.t === '拒否されるタスク' && kept.mError.includes('完了済み') && kept.tError.includes('完了済み'), '失敗時は入力を保持し、理由を表示', kept)
          await api(c, `window.gtd.projects.setCompleted({ id: ${JSON.stringify(ids.failProject)}, completed: false })`)

          // 共通の検索・状態・ソート（絞り込みで0件のカードも残す）
          await openProject(c, ids.cp)
          await c.setInput('input[aria-label="タイトルで絞り込み"]', 'M1のタスク')
          await sleep(300)
          list = await cards(c)
          assert(list.length === 4 && list[1].tasks.length === 2 && list.filter((_, i) => i !== 1).every((x) => x.tasks.length === 0), '検索は全カード共通・0件のカードも残す', list.map((x) => [x.label, x.tasks.length]))
          await c.click(`document.querySelector('[aria-label^="タイトルで並べ替え"]')`)
          await sleep(300)
          list = await cards(c)
          assert(JSON.stringify(list[1].tasks) === JSON.stringify([ids.c2, ids.c1]), 'タイトル順（a → b）', list[1].tasks)
          await c.click(`document.querySelector('[aria-label^="タイトルで並べ替え"]')`)
          await sleep(300)
          assert(JSON.stringify((await cards(c))[1].tasks) === JSON.stringify([ids.c1, ids.c2]), 'タイトル降順（b → a）')
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '')
          await api(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(ids.c3)}, completed: true })`)
          await reload(c)
          await openProject(c, ids.cp)
          await c.click(c.byText('button', '完了'))
          await sleep(300)
          list = await cards(c)
          assert(list.length === 4 && JSON.stringify(list.map((x) => x.tasks.length)) === JSON.stringify([1, 0, 0, 0]) && list[0].tasks[0] === ids.c3, '状態フィルターも全カード共通', list.map((x) => x.tasks))
          await c.click(c.byText('button', 'すべて'))

          // 完了切り替え（Space）・選択（Enter）・詳細の表示（カードの一覧で）
          // M1 の並びは作成日時の降順（a-M1, b-M1）。End で b-M1（c1）を現在行にする
          await c.focus(`[data-card-list="group:${ids.m1}"]`)
          await c.key('End', 35)
          await c.space()
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.find((t) => t.id === ${JSON.stringify(ids.c1)}).completedAt !== null)()`, 5000, 'Spaceで完了')
          await c.enter()
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, 'Enterで選択して詳細')
          // 所属変更（詳細パネル）: M1 → M3。タイトルのドラフトを失わない
          await c.setInput('[data-testid=task-editor] input:not([type=hidden])', 'b-M1のタスク（ドラフト）')
          await c.evaluate(`(() => { const s = document.querySelector('[data-testid=task-project-select]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(`${ids.cp}:${ids.m3}`)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.find((t) => t.id === ${JSON.stringify(ids.c1)}).milestoneId === ${JSON.stringify(ids.m3)})()`, 5000, '所属変更')
          await sleep(300)
          list = await cards(c)
          assert(list.find((x) => x.key === `group:${ids.m3}`).tasks.includes(ids.c1) && !list[1].tasks.includes(ids.c1), 'M3のカードへ移る', list.map((x) => x.tasks))
          assert((await c.evaluate(`document.querySelector('[data-testid=task-editor] input:not([type=hidden])').value`)) === 'b-M1のタスク（ドラフト）', 'タイトルのドラフトを保持')
          await c.click(c.byText('[data-testid=task-editor] button', '変更を取り消す'))

          // カードの見出しから名前変更（キーボードでも到達できるボタン）
          await c.focus(`[data-rename-milestone="${ids.m2}"]`)
          await c.enter()
          await c.waitFor(`document.querySelector('[data-testid=milestone-name-editor] input')`, 3000, '見出しに名前の編集欄')
          const inCard = await c.evaluate(`!!document.querySelector('[data-card-key="group:${ids.m2}"] [data-testid=milestone-name-editor]')`)
          assert(inCard, 'そのカードの見出しの位置で編集する')
          await c.setInput('[data-testid=milestone-name-editor] input', 'M2（改）')
          await c.focus('[data-testid=milestone-name-editor] input')
          await c.enter()
          await c.waitFor(`[...document.querySelectorAll('[data-testid=group-label]')].some((e) => e.textContent === 'M2（改）')`, 5000, '見出しの更新')

          // 選択・完了操作の回帰: Inboxへ解除（詳細パネル）
          await c.click(`document.querySelector('[data-testid=task-list] [data-task-id="${ids.c2}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, '詳細')
          await c.evaluate(`(() => { const s = document.querySelector('[data-testid=task-project-select]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ''); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.find((t) => t.id === ${JSON.stringify(ids.c2)}).projectId === null)()`, 5000, 'Inboxへ解除')
          await sleep(300)
          assert(!(await cards(c)).some((x) => x.tasks.includes(ids.c2)), '解除したタスクはカードから消える')
          writeFileSync(join(root, 'project-cards.png'), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      'カードの幅: 全カード同時に変わる（ドラッグ中は保存しない・終了時に保存）、最小・最大、キーボード操作とARIA、左右の幅は変えない、横スクロールはカード列だけ',
      () =>
        withApp({ label: 'card-width', userDataDir: dir }, async (app) => {
          const c = app.cdp
          await openProject(c, ids.cp)
          const before = await workspace(c)
          assert(before.milestoneCardWidth === 320 && before.sidebarWidth === 260 && before.detailWidth === 340, '初期幅320px（既存の左右の幅は保持）', before)
          let list = await cards(c)
          assert(list.every((x) => x.width === 320), '全カードが同じ幅', list.map((x) => x.width))
          const aria = await c.evaluate(`(() => { const h = document.querySelector('[data-testid=card-resize-handle]'); return { role: h.getAttribute('role'), name: h.getAttribute('aria-label'), now: h.getAttribute('aria-valuenow'), min: h.getAttribute('aria-valuemin'), max: h.getAttribute('aria-valuemax'), orientation: h.getAttribute('aria-orientation'), tab: h.tabIndex, inListbox: !!h.closest('[role=listbox]') } })()`)
          assert(aria.role === 'separator' && aria.name.includes('カードの幅') && aria.now === '320' && aria.min === '144' && aria.max === '640' && aria.orientation === 'vertical' && aria.tab === 0 && !aria.inListbox, 'ハンドルの名前・現在値・最小・最大（一覧の外）', aria)

          // 横スクロール: ウィンドウ・メインパネルではなく、カード列の中だけ
          const scroll = await c.evaluate(`(() => { const b = document.querySelector('[data-testid=milestone-board]'); const m = document.querySelector('main'); const d = document.scrollingElement; return { board: b.scrollWidth > b.clientWidth, main: m.scrollWidth <= m.clientWidth, doc: d.scrollWidth <= d.clientWidth, mainV: m.scrollHeight <= m.clientHeight + 1 } })()`)
          assert(scroll.board && scroll.main && scroll.doc && scroll.mainV, 'カード列だけが横スクロール（ウィンドウ・メインは横にも縦にも伸びない）', scroll)

          // ドラッグ（2枚目のカードのハンドル）: 途中は保存しない、カード外へ出ても続く、終えた時に保存
          // 2枚目のカードのハンドル（カード列の横スクロールで見える位置へ移してから操作する）
          const handle = await c.evaluate(`(() => { const h = document.querySelectorAll('[data-testid=card-resize-handle]')[1]; h.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 40 } })()`)
          const hit = await c.evaluate(`document.elementFromPoint(${handle.x}, ${handle.y})?.dataset.testid ?? null`)
          assert(hit === 'card-resize-handle', 'ハンドルを押せる位置にある', { handle, hit })
          const selectedBefore = await c.evaluate(`document.querySelector('[data-testid=task-list] [aria-selected=true]')?.dataset.taskId ?? null`)
          const tasksBefore = JSON.stringify(await tasks(c))
          await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y: handle.y })
          await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', buttons: 1, clickCount: 1 })
          await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 60, y: handle.y + 300, button: 'left', buttons: 1 })
          await sleep(150)
          list = await cards(c)
          const mid = await workspace(c)
          assert(list.every((x) => x.width === 380), 'ドラッグ中は全カードへ即時反映（カードの外へ出ても続く）', list.map((x) => x.width))
          assert(mid.milestoneCardWidth === 320, 'ドラッグ中は保存しない', mid)
          await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 1000, y: handle.y, button: 'left', buttons: 1 })
          await sleep(100)
          assert((await cards(c)).every((x) => x.width === 640), '最大640pxで止まる')
          await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 100, y: handle.y, button: 'left', buttons: 1 })
          await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + 100, y: handle.y, button: 'left', buttons: 0, clickCount: 1 })
          await c.waitFor(`(async () => (await window.gtd.workspace.get()).data.milestoneCardWidth === 420)()`, 3000, 'ドラッグ終了時に保存')
          list = await cards(c)
          assert(list.every((x) => x.width === 420), '全カードが同じ幅', list.map((x) => x.width))
          const afterDrag = await workspace(c)
          assert(afterDrag.sidebarWidth === 260 && afterDrag.detailWidth === 340, '左右の幅は変えない', afterDrag)
          assert(JSON.stringify(await tasks(c)) === tasksBefore, '幅の変更でタスクの完了などは変わらない')
          assert((await c.evaluate(`document.querySelector('[data-testid=task-list] [aria-selected=true]')?.dataset.taskId ?? null`)) === selectedBefore, '幅の変更でタスクの選択は変わらない')

          // ドラッグのキャンセル（Esc）: 元の幅に戻し、保存しない（1枚目のカードのハンドル）
          const first = await c.evaluate(`(() => { const h = document.querySelectorAll('[data-testid=card-resize-handle]')[0]; h.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 40 } })()`)
          await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: first.x, y: first.y })
          await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: first.x, y: first.y, button: 'left', buttons: 1, clickCount: 1 })
          await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: first.x - 150, y: first.y, button: 'left', buttons: 1 })
          await sleep(100)
          assert((await cards(c)).every((x) => x.width === 270), 'ドラッグ中（縮小）', (await cards(c)).map((x) => x.width))
          await c.key('Escape', 27)
          await sleep(100)
          await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: first.x - 150, y: first.y, button: 'left', buttons: 0, clickCount: 1 })
          await sleep(300)
          assert((await cards(c)).every((x) => x.width === 420) && (await workspace(c)).milestoneCardWidth === 420, 'Escでキャンセル（元の幅・保存しない）')

          // キーボード: ← → ±16、Home で最小、End で最大（押すたびに保存）
          await c.focus('[data-testid=card-resize-handle]')
          await c.key('ArrowLeft', 37)
          await c.waitFor(`(async () => (await window.gtd.workspace.get()).data.milestoneCardWidth === 404)()`, 3000, '← で縮小・保存')
          await c.key('Home', 36)
          await c.waitFor(`(async () => (await window.gtd.workspace.get()).data.milestoneCardWidth === 144)()`, 3000, 'Home で最小')
          assert((await cards(c)).every((x) => x.width === 144) && (await c.evaluate(`document.querySelector('[data-testid=card-resize-handle]').getAttribute('aria-valuenow')`)) === '144', '最小144px（フェーズ5.8で240から変更）')
          await c.key('ArrowLeft', 37)
          await sleep(200)
          assert((await workspace(c)).milestoneCardWidth === 144, '最小より小さくしない')
          await c.key('End', 35)
          await c.waitFor(`(async () => (await window.gtd.workspace.get()).data.milestoneCardWidth === 640)()`, 3000, 'End で最大')
          await c.key('ArrowRight', 39)
          await sleep(200)
          assert((await workspace(c)).milestoneCardWidth === 640, '最大より大きくしない')
          await c.key('ArrowLeft', 37)
          await c.waitFor(`(async () => (await window.gtd.workspace.get()).data.milestoneCardWidth === 624)()`, 3000, '← で縮小')
          // 不正値はMainで拒否する（保存値は変わらない）
          const invalid = await c.evaluate(`window.gtd.workspace.save({ ...${JSON.stringify(await workspace(c))}, milestoneCardWidth: 9999 })`)
          assert(!invalid.ok && invalid.error.code === 'INVALID_INPUT' && (await workspace(c)).milestoneCardWidth === 624, '範囲外の保存要求は拒否', invalid)

          // プロジェクトを切り替えても同じ幅
          await openProject(c, ids.failProject)
          assert((await cards(c)).every((x) => x.width === 624), '別のプロジェクトでも共通の幅')
          await openProject(c, ids.cp)
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      'カードの幅: 新しいアプリのセッションで復元する（左右の幅も保持）',
      () =>
        withApp({ label: 'card-width-restore', userDataDir: dir }, async (app) => {
          const c = app.cdp
          await c.waitFor(`location.hash === ${JSON.stringify(`#/projects/${ids.cp}`)}`, 5000, '最後の画面')
          await c.waitFor(`document.querySelector('[data-testid=milestone-card]')`, 5000, 'カード')
          await sleep(300)
          const list = await cards(c)
          const settings = await workspace(c)
          assert(list.every((x) => x.width === 624) && settings.milestoneCardWidth === 624, '保存した幅を復元', { widths: list.map((x) => x.width), settings })
          assert(settings.sidebarWidth === 260 && settings.detailWidth === 340, '左右の幅は変わらない', settings)
          const navWidth = await c.evaluate(`Math.round(document.querySelector('nav[aria-label="ナビゲーション"]').getBoundingClientRect().width)`)
          assert(Math.abs(navWidth - 260) <= 2, 'ナビゲーションの実寸も保持', navWidth)
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      '大量データ（4,000件・マイルストン6つ）: カードごとの仮想化、← → でカード間を移動、End、aria-activedescendant は描画済みの行だけ、カードの高さは画面内',
      async () => {
        const db = await createDatabaseAt(join(bulkDir, 'gtd.sqlite'))
        const projectId = randomUUID()
        db.prepare('INSERT INTO projects (id, name, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, NULL)').run(projectId, '大量', 'a', 'a')
        const milestoneIds = []
        // 5.6: プロジェクトのタスクは必ずマイルストンに所属する（5.5までの「未設定」の代わりに6つ目のマイルストン）
        for (let i = 0; i < 6; i++) {
          const id = randomUUID()
          milestoneIds.push(id)
          const at = `2026-11-0${i + 1}T00:00:00.000Z`
          db.prepare('INSERT INTO milestones (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, projectId, `M${i + 1}`, at, at)
        }
        const rows = []
        const insert = db.prepare('INSERT INTO tasks (id, title, created_at, updated_at, completed_at, project_id, milestone_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        db.transaction(() => {
          for (let i = 0; i < 4000; i++) {
            const id = randomUUID()
            const milestoneId = milestoneIds[i % 6]
            const at = new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString()
            insert.run(id, `タスク ${i}`, at, at, null, projectId, milestoneId)
            rows.push({ id, createdAt: at, milestoneId })
          }
        })()
        db.close()
        await withApp({ label: 'cards-bulk', userDataDir: bulkDir }, async (app) => {
          const c = app.cdp
          await openProject(c, projectId)
          await c.waitFor(`document.querySelectorAll('[data-testid=task-list] [role=option]').length > 0`, 10000, '一覧')
          await c.waitFor(`[...document.querySelectorAll('[data-testid=milestone-card]')].length === 6 && [...document.querySelectorAll('[data-testid=milestone-card]')].every((e) => e.querySelector('[role=option]'))`, 10000, 'すべてのカードの描画（カードごとの仮想リストは別々に測定される）')
          await sleep(200)
          const rendered = await c.evaluate(`[...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => e.querySelectorAll('[role=option]').length)`)
          assert(rendered.length === 6 && rendered.every((n) => n > 0 && n < 60), 'カードごとに一部だけ描画（全件DOM描画にしない）', rendered)
          const total = await c.evaluate(`document.querySelectorAll('[role=option]').length`)
          assert(total < 360, '全体の描画行数も一部だけ', total)
          const bounds = await c.evaluate(`(() => { const m = document.querySelector('main').getBoundingClientRect(); return [...document.querySelectorAll('[data-testid=milestone-card]')].every((e) => e.getBoundingClientRect().bottom <= m.bottom + 1) && document.querySelector('main').scrollHeight <= document.querySelector('main').clientHeight + 1 })()`)
          assert(bounds, 'カードの高さは画面内（タスク数でウィンドウが縦に伸びない）')
          const ids1 = new Set(await c.evaluate(`[...document.querySelectorAll('[role=option]')].map((e) => e.id)`))
          assert(ids1.size === total, '行のIDはカード間でも重複しない')

          // キーボード: M1 の一覧 → End（最後の行・描画済み）→ → で M2 へ → ← で M1 へ戻る
          const activeInfo = () =>
            c.evaluate(`(() => { const list = document.activeElement; const id = list?.getAttribute('aria-activedescendant'); const el = id ? document.getElementById(id) : null; return { card: list?.dataset.cardList ?? null, id, exists: id ? !!el && list.contains(el) : null, taskId: el?.dataset.taskId ?? null } })()`)
          await c.focus(`[data-card-list="group:${milestoneIds[0]}"]`)
          await c.key('End', 35)
          await sleep(400)
          let info = await activeInfo()
          const lastOfM1 = rows.filter((r) => r.milestoneId === milestoneIds[0]).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).at(-1)
          assert(info.card === `group:${milestoneIds[0]}` && info.exists && info.taskId === lastOfM1.id, 'End で最後の行（描画済みの要素を参照）', info)
          await c.key('ArrowRight', 39)
          await sleep(300)
          info = await activeInfo()
          assert(info.card === `group:${milestoneIds[1]}` && (info.id === null || info.exists), '→ で隣のカードの一覧へ（存在しない要素を参照しない）', info)
          await c.key('ArrowDown', 40)
          await sleep(200)
          info = await activeInfo()
          assert(info.card === `group:${milestoneIds[1]}` && info.exists, '移った先のカードで ↓ が効く', info)
          await c.key('ArrowLeft', 37)
          await sleep(300)
          info = await activeInfo()
          assert(info.card === `group:${milestoneIds[0]}` && (info.id === null || info.exists), '← で前のカードへ', info)
          // 現在行をスクロールで見えなくしても、存在しない要素を参照しない
          await c.evaluate(`document.querySelector('[data-card-list="group:${milestoneIds[0]}"]').closest('[data-testid=task-list-scroll]').scrollTop = 0`)
          await sleep(300)
          info = await activeInfo()
          assert(info.id === null || info.exists, 'スクロールで現在行が描画範囲外になっても、aria-activedescendant は存在する要素だけ', info)
          // Tab で一覧 → NEW TASK → 幅のハンドル の順に到達できる
          await c.focus(`[data-card-list="group:${milestoneIds[0]}"]`)
          const tabOrder = []
          for (let i = 0; i < 3; i++) {
            await c.key('Tab', 9)
            tabOrder.push(await c.evaluate(`document.activeElement.dataset.testid ?? document.activeElement.getAttribute('aria-label')`))
          }
          assert(tabOrder[0] === 'new-task-' + milestoneIds[0] + '-button' && tabOrder[1] === 'card-resize-handle' && tabOrder[2]?.includes('M2'), 'Tab で NEW TASK・幅のハンドル・次のカードの見出しの操作へ', tabOrder)
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
      }
    ]
  ]
}
