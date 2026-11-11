// フェーズ5.6: タスク・マイルストン・プロジェクトの削除、削除由来の非表示、所属ルールの変更、0006 の移行のUIシナリオ。run.mjs から呼ぶ。
// すべて専用の一時userData（root配下）だけを使う。準備はPreloadの用途別APIで行い、DBを直接変更するのは
// 事前データの用意と、失敗・保存中を起こすための一時的な書き込みロック（テスト用DBだけ）に限る。
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { goToProject, assert, clickRowShowDetail, keyWith, MOD, createDatabaseAt, firstMilestoneId, openDatabaseReadOnly, PROJECT_ROOT, requestQuit, sleep } from './lib.mjs'

const require = createRequire(join(PROJECT_ROOT, 'package.json'))

export function deletionScenarios({ withApp, root }) {
  const dir = join(root, 'userData-deletion')
  const migrationDir = join(root, 'userData-deletion-migration')
  const dbFile = join(dir, 'gtd.sqlite')
  const ids = {}

  const api = (c, expression) =>
    c.evaluate(`(${expression}).then((r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data })`)
  const apiRaw = (c, expression) => c.evaluate(expression)
  const tasks = (c) => api(c, 'window.gtd.tasks.list()')
  const projects = (c) => api(c, 'window.gtd.projects.list()')
  const milestones = (c) => api(c, 'window.gtd.milestones.list()')
  const reload = async (c) => {
    await c.evaluate('location.reload()')
    await c.waitFor(`document.querySelector('nav button[aria-label="Inbox"]')`, 10000, '再読み込み')
    await sleep(500)
  }
  const openInbox = async (c) => {
    await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
    await c.waitFor(`location.hash === '#/inbox'`, 5000, 'Inbox')
    await sleep(200)
  }
  const openProject = async (c, projectId) => {
    await goToProject(c, projectId)
    await c.waitFor(`location.hash === ${JSON.stringify(`#/projects/${projectId}`)}`, 5000, 'プロジェクトを開く')
    await c.waitFor(`document.querySelector('[data-testid=milestone-board]')`, 5000, 'カードの表示')
    await sleep(200)
  }
  const createTask = async (c, title, projectId, milestoneId) =>
    (
      await api(
        c,
        projectId
          ? `window.gtd.tasks.create({ title: ${JSON.stringify(title)}, projectId: ${JSON.stringify(projectId)}, milestoneId: ${JSON.stringify(milestoneId)} })`
          : `window.gtd.tasks.create({ title: ${JSON.stringify(title)} })`
      )
    ).id
  const listIds = (c) => c.evaluate(`[...document.querySelectorAll('[data-testid=task-list] [role=option]')].map((e) => e.dataset.taskId)`)
  const badge = (c) => c.evaluate(`document.querySelector('[data-testid=nav-inbox-badge]')?.textContent ?? null`)
  const announcement = (c) => c.evaluate(`document.querySelector('[data-testid=task-announcement]')?.textContent ?? ''`)
  const dialogOpen = (c, testId) => c.evaluate(`!!document.querySelector('[data-testid=${testId}] [role=dialog]')`)
  const waitDialog = (c, testId, label) => c.waitFor(`document.querySelector('[data-testid=${testId}] [role=dialog]')`, 5000, label)
  const waitDialogClosed = (c, testId, label) => c.waitFor(`!document.querySelector('[data-testid=${testId}]')`, 5000, label)
  const dialogText = (c, testId) => c.evaluate(`document.querySelector('[data-testid=${testId}] [role=dialog]')?.innerText ?? null`)
  const anyDialog = (c) => c.evaluate(`document.querySelector('[role=dialog]')?.innerText ?? null`)
  const openRowMenu = async (c, taskId) => {
    await c.click(`document.querySelector('[data-row-menu-task-id="${taskId}"]')`)
    await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')`, 3000, '行のメニュー')
    // 開いた時の位置決め・フォーカス移動が終わってから項目を押す（押す位置がずれて別の項目を押さないように）
    await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')?.contains(document.activeElement)`, 3000, '行のメニューへフォーカス')
    await sleep(150)
  }
  const shiftF10 = async (c) => {
    await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'F10', code: 'F10', windowsVirtualKeyCode: 121, modifiers: 8 })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F10', code: 'F10', windowsVirtualKeyCode: 121, modifiers: 8 })
  }
  // 一時DBの直接の読み取り（アプリの実行中でもWALのため読める。読み取り専用）
  const readDb = (file, fn) => {
    const db = openDatabaseReadOnly(file)
    try {
      return fn(db)
    } finally {
      db.close()
    }
  }
  const rawTask = (id) => readDb(dbFile, (db) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id))
  const rawMilestone = (id) => readDb(dbFile, (db) => db.prepare('SELECT * FROM milestones WHERE id = ?').get(id))
  // テスト用DBへ一時的な書き込みロックをかける（Mainの書き込みは busy_timeout の間待ってから失敗する）
  const lockDb = () => {
    const Database = require('better-sqlite3')
    const locker = new Database(dbFile)
    locker.exec('BEGIN IMMEDIATE')
    return () => {
      locker.exec('ROLLBACK')
      locker.close()
    }
  }

  return [
    [
      'タスクの削除（Inbox）: 行のメニュー・右クリック・Shift+F10・Delete キー（フェーズ5.9から確認なし）、失敗時は行を残す、二重実行なし、他のタスクの未保存入力を保持、保存中の削除と遅延更新',
      () =>
        withApp({ label: 'delete-tasks', userDataDir: dir }, async (app) => {
          const c = app.cdp
          const t = {}
          for (const name of ['削除A', '削除B', '削除C', '削除D', '削除E', '削除F']) t[name] = await createTask(c, name)
          await reload(c)
          await openInbox(c)
          assert((await badge(c)) === '6', 'バッジ6件', await badge(c))
          // 削除の操作の間、確認ダイアログが一度も出ないことを記録する
          await c.evaluate(`(() => { window.__dialogSeen = false; new MutationObserver(() => { if (document.querySelector('[role=dialog]')) window.__dialogSeen = true }).observe(document.body, { childList: true, subtree: true }) })()`)
          const structure = await c.evaluate(`({
            inOption: document.querySelectorAll('[role=option] button, [role=option] [role=button], [role=option] [tabindex="0"]').length,
            menuButtons: document.querySelectorAll('[data-row-menu-task-id]').length,
            menuTab: [...document.querySelectorAll('[data-row-menu-task-id]')].every((b) => b.tabIndex === -1 && !b.closest('[role=listbox]'))
          })`)
          assert(structure.inOption === 0 && structure.menuButtons === 6 && structure.menuTab, 'option の中に操作要素を置かない（「…」は一覧の外・Tab移動の対象外）', structure)

          // マウス: 「…」→ メニュー（削除だけ。TaskRow）→ 削除（確認なし）
          await openRowMenu(c, t['削除F'])
          const items = await c.evaluate(`[...document.querySelectorAll('[data-testid=task-row-menu] [role=menuitem]')].map((e) => e.textContent)`)
          assert(JSON.stringify(items) === JSON.stringify(['削除']), 'Inboxの行の「…」メニューは削除だけ（TaskRow）', items)
          await c.click(`document.querySelector('[data-testid=task-row-menu-delete]')`)
          await c.waitFor(`!document.querySelector('[data-testid=task-list] [data-task-id="${t['削除F']}"]')`, 5000, '確認なしで一覧から消える')
          assert(rawTask(t['削除F']) === undefined, 'DBから物理削除')

          // 右クリック → メニュー
          await c.evaluate(`document.querySelector('[data-testid=task-list] [data-task-id="${t['削除B']}"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`)
          await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')`, 3000, '右クリックでメニュー')
          await c.key('Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=task-row-menu]')`, 3000, 'メニューを閉じる')

          // キーボード: Shift+F10 → メニュー（削除だけ）→ 削除、Delete キー → 削除（どちらも確認なし）
          await c.focus('[data-testid=task-list]')
          await c.key('Home', 36)
          const first = await c.evaluate(`document.getElementById(document.querySelector('[data-testid=task-list]').getAttribute('aria-activedescendant'))?.dataset.taskId`)
          assert(first === t['削除E'], '先頭（新しい順）が現在行', first)
          await shiftF10(c)
          await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')?.contains(document.activeElement)`, 3000, 'Shift+F10 でメニュー')
          await sleep(200)
          const menuFocus = await c.evaluate(`document.activeElement?.textContent`)
          assert(menuFocus === '削除', 'メニューの項目（削除だけ）にフォーカス', menuFocus)
          await c.key('End', 35)
          await c.enter()
          await c.waitFor(`!document.querySelector('[data-testid=task-list] [data-task-id="${t['削除E']}"]')`, 5000, '一覧から消える')
          assert(rawTask(t['削除E']) === undefined, 'DBから物理削除', rawTask(t['削除E']))
          assert((await announcement(c)).includes('「削除E」を削除しました'), '結果を読み上げる', await announcement(c))
          await c.waitFor(`document.querySelector('[data-testid=nav-inbox-badge]').textContent === '4'`, 3000, 'バッジの更新')

          // 他のタスクの未保存の入力を失わない: Cの詳細でタイトルを編集中に、Bを削除 → Cのドラフトは残る
          await clickRowShowDetail(c, `document.querySelector('[data-testid=task-list] [data-task-id="${t['削除C']}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, 'Cの詳細')
          await c.setInput('[data-testid=task-editor] input:not([type=hidden])', '削除Cのドラフト')
          await openRowMenu(c, t['削除B'])
          await c.click(`document.querySelector('[data-testid=task-row-menu-delete]')`)
          await c.waitFor(`!document.querySelector('[data-testid=task-list] [data-task-id="${t['削除B']}"]')`, 5000, 'Bを削除')
          assert(rawTask(t['削除B']) === undefined, 'Bを削除')
          const keptDraft = await c.evaluate(`({ value: document.querySelector('[data-testid=task-editor] input:not([type=hidden])')?.value, selected: document.querySelector('[data-testid=task-list] [aria-selected=true]')?.dataset.taskId })`)
          assert(keptDraft.value === '削除Cのドラフト' && keptDraft.selected === t['削除C'], '他のタスクの未保存入力・選択を保持', keptDraft)

          // 選択中・未保存のタスク自身の削除: 確認なしで削除し、詳細を空に戻す。移動時の未保存の確認も出ない
          await openRowMenu(c, t['削除C'])
          await c.click(`document.querySelector('[data-testid=task-row-menu-delete]')`)
          await c.waitFor(`!document.querySelector('[data-testid=task-editor]')`, 5000, '詳細を閉じる（選択解除）')
          assert(rawTask(t['削除C']) === undefined, 'Cを削除')
          assert((await c.evaluate(`document.querySelector('#detail-panel').innerText`)).includes('タスクを選択すると'), '詳細パネルを空の表示に戻す')
          await c.click(`document.querySelector('nav button[aria-label="Project"]')`)
          await sleep(300)
          assert((await anyDialog(c)) === null, '削除したタスクの未保存の確認は出ない', await anyDialog(c))
          await openInbox(c)

          // 失敗: DBをロックした状態で削除 → 一覧の上に理由、行・DBは残る
          const release = lockDb()
          try {
            await openRowMenu(c, t['削除A'])
            await c.click(`document.querySelector('[data-testid=task-row-menu-delete]')`)
            await c.waitFor(`document.querySelector('[data-testid=task-delete-error]')`, 15000, '失敗の表示（ロックの待ち時間を含む）')
          } finally {
            release()
          }
          const failed = await c.evaluate(`({ error: document.querySelector('[data-testid=task-delete-error]').textContent, row: !!document.querySelector('[data-testid=task-list] [data-task-id="${t['削除A']}"]') })`)
          assert(failed.error.startsWith('削除できませんでした') && failed.row && rawTask(t['削除A']), '失敗時は行を残し、理由を表示', failed)
          // 二重実行なし: Delete キーを続けて2回押しても1回だけ（2回目の NOT_FOUND を出さない）
          await c.click(`document.querySelector('[data-testid=task-delete-error] button')`)
          await c.click(`document.querySelector('[data-testid=task-list] [data-task-id="${t['削除A']}"]')`)
          await c.focus('[data-testid=task-list]')
          await c.evaluate(`(() => { const l = document.querySelector('[data-testid=task-list]'); for (let i = 0; i < 2; i++) l.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })) })()`)
          await c.waitFor(`!document.querySelector('[data-testid=task-list] [data-task-id="${t['削除A']}"]')`, 5000, '削除')
          await sleep(300)
          assert(rawTask(t['削除A']) === undefined && !(await c.evaluate(`!!document.querySelector('[data-testid=task-delete-error], [data-testid=assign-error]')`)), '1回だけ削除（エラーなし）')

          // 保存中の削除: タイトルの保存（IPCの往復中）と同じ処理の中で削除を要求する → 保存が終わってから削除する（復活しない）
          await clickRowShowDetail(c, `document.querySelector('[data-testid=task-list] [data-task-id="${t['削除D']}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, 'Dの詳細')
          await c.setInput('[data-testid=task-editor] input:not([type=hidden])', '削除D（保存中）')
          await sleep(300)
          const requested = await c.evaluate(`(async () => {
            const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
            const helper = () => document.querySelector('[data-testid=task-editor] .MuiFormHelperText-root')?.textContent
            document.querySelector('[data-testid=task-editor] form').requestSubmit()
            await flush()
            document.querySelector('[data-row-menu-task-id="${t['削除D']}"]').click()
            await flush()
            const dirtyAtRequest = helper() === '未保存の変更があります'
            const item = document.querySelector('[data-testid=task-row-menu-delete]')
            item?.click()
            return { menuItem: !!item, dirtyAtRequest }
          })()`)
          assert(requested.menuItem && requested.dirtyAtRequest, '保存の応答より前（未保存の表示のまま）に削除を要求した', requested)
          await c.waitFor(`!document.querySelector('[data-testid=task-list] [data-task-id="${t['削除D']}"]')`, 5000, '保存の後に削除')
          await sleep(500)
          assert(rawTask(t['削除D']) === undefined, '削除後に対象が復活しない')
          assert((await c.evaluate('window.__dialogSeen')) === false, '削除で確認ダイアログを一度も出さない')

          // 遅延更新: 削除と更新が同時に届いても、削除後の更新は NOT_FOUND（行を作り直さない）
          const late = await createTask(c, '遅延更新')
          const raced = await c.evaluate(`Promise.all([window.gtd.tasks.delete({ id: ${JSON.stringify(late)} }), window.gtd.tasks.updateTitle({ id: ${JSON.stringify(late)}, title: '遅れた更新' }), window.gtd.tasks.setCompleted({ id: ${JSON.stringify(late)}, completed: true })])`)
          assert(raced[0].ok && raced[1].error?.code === 'NOT_FOUND' && raced[2].error?.code === 'NOT_FOUND' && rawTask(late) === undefined, '削除後の遅延更新は対象を復活させない', raced)
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      'タスクの削除（プロジェクトのカード）: 行のメニュー・Delete キー（確認なし）、最後の未完了タスクを削除してもプロジェクトは自動で完了しない',
      () =>
        withApp({ label: 'delete-card-tasks', userDataDir: dir }, async (app) => {
          const c = app.cdp
          ids.p = (await api(c, `window.gtd.projects.create({ name: 'カードの削除' })`)).id
          const m = await firstMilestoneId(c, ids.p)
          const open = await createTask(c, '未完了の最後', ids.p, m)
          const done = await createTask(c, '完了済み', ids.p, m)
          const other = await createTask(c, 'キーで削除', ids.p, m)
          await api(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(done)}, completed: true })`)
          await reload(c)
          await openProject(c, ids.p)
          await openRowMenu(c, open)
          const items = await c.evaluate(`[...document.querySelectorAll('[data-testid=task-row-menu] [role=menuitem]')].map((e) => e.textContent)`)
          assert(JSON.stringify(items) === JSON.stringify(['削除']), 'カードの行の「…」メニューは削除だけ（TaskRow）', items)
          await c.click(`document.querySelector('[data-testid=task-row-menu-delete]')`)
          await c.waitFor(`!document.querySelector('[data-testid=task-list] [data-task-id="${open}"]')`, 5000, '確認なしで削除')
          assert(rawTask(open) === undefined && (await anyDialog(c)) === null, 'カードから削除（確認なし）')
          // Delete キー（カードの一覧。既定の並べ替えは手動順＝作成日時の古い順のため、「キーで削除」は末尾）
          await c.focus(`[data-card-list="group:${m}"]`)
          await c.key('End', 35)
          await c.key('Delete', 46)
          await c.waitFor(`!document.querySelector('[data-testid=task-list] [data-task-id="${other}"]')`, 5000, 'Delete キーで削除')
          assert(rawTask(other) === undefined, 'キーボードで削除')
          await sleep(300)
          const status = await c.evaluate(`document.querySelector('#detail-panel [data-testid=project-status]')?.textContent`)
          assert(status === '未完了' && (await projects(c)).find((p) => p.id === ids.p).completedAt === null, '未完了タスクが0件になっても自動で完了しない', status)
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      'マイルストンの削除: 空なら確認なし（最後の1件も可・作り直さない）、絞り込みで0件に見えてもDBの件数で確認、タスクありは件数を示して非表示化、確認中の件数変化は再確認、0件のプロジェクトはタスク追加・紐付け不可、非表示の未完了タスクは完了を妨げない',
      () =>
        withApp({ label: 'delete-milestones', userDataDir: dir }, async (app) => {
          const c = app.cdp
          ids.inbox = await createTask(c, '残るInboxタスク')
          ids.mp = (await api(c, `window.gtd.projects.create({ name: 'マイルストンの削除' })`)).id
          const m0 = await firstMilestoneId(c, ids.mp)
          const m1 = (await api(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(ids.mp)}, name: 'M1' })`)).id
          const m2 = (await api(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(ids.mp)}, name: 'M2' })`)).id
          const m1a = await createTask(c, 'M1の未完了', ids.mp, m1)
          const m1b = await createTask(c, 'M1の完了済み', ids.mp, m1)
          await api(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(m1b)}, completed: true })`)
          const m2done = await createTask(c, 'M2の完了済み', ids.mp, m2)
          await api(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(m2done)}, completed: true })`)
          await reload(c)
          const badgeBefore = await badge(c)
          await openProject(c, ids.mp)
          const openMenu = async (milestoneId) => {
            await c.click(`document.querySelector('[data-milestone-menu="${milestoneId}"]')`)
            await c.waitFor(`document.querySelector('[data-testid=milestone-menu] [role=menu]')`, 3000, 'カードのメニュー')
            await c.click(`document.querySelector('[data-testid=milestone-menu-delete]')`)
          }

          // 空のマイルストン（初期マイルストン）: 確認なしで削除
          await openMenu(m0)
          await c.waitFor(`!document.querySelector('[data-card-key="group:${m0}"]')`, 5000, '空のカードが消える')
          assert(!(await dialogOpen(c, 'milestone-delete-dialog')) && rawMilestone(m0) === undefined, '空のマイルストンは確認なしで物理削除')

          // 絞り込み（未完了）で0件に見えるM2: DBには完了済みが1件 → 確認を出す（件数1）
          const m2Count = await c.evaluate(`document.querySelector('[data-card-key="group:${m2}"] [data-testid=card-count]').textContent`)
          assert(m2Count === '0 件', 'M2は未完了の表示では0件', m2Count)
          await openMenu(m2)
          await waitDialog(c, 'milestone-delete-dialog', '件数ありの確認')
          let text = await dialogText(c, 'milestone-delete-dialog')
          assert(text.includes('「M2」') && text.includes('所属するタスク: 1 件') && text.includes('タスクは削除されず、画面に表示されなくなります'), 'DBの件数（完了済みを含む）と、タスクは残ることを示す', text)
          await c.click(`document.querySelector('[data-testid=milestone-delete-dialog-cancel]')`)
          await waitDialogClosed(c, 'milestone-delete-dialog', 'キャンセル')
          assert(rawMilestone(m2) && rawTask(m2done).milestone_id === m2, 'キャンセルでは変えない')

          // 確認中に件数が変わった: 確認（1件）→ APIでM2にタスクを追加 → 削除 → 削除せずに再確認（2件）→ 削除
          await openMenu(m2)
          await waitDialog(c, 'milestone-delete-dialog', '確認（件数変化）')
          const added = await createTask(c, '確認中に追加', ids.mp, m2)
          await c.click(`document.querySelector('[data-testid=milestone-delete-dialog-confirm]')`)
          await c.waitFor(`document.querySelector('[data-testid=milestone-delete-dialog-notice]')`, 5000, '件数変化の再確認')
          text = await dialogText(c, 'milestone-delete-dialog')
          assert(text.includes('所属するタスク: 2 件') && rawMilestone(m2) && rawTask(added).hidden_at === null, '削除範囲を無断で広げず、件数を更新して再確認', text)
          await c.click(`document.querySelector('[data-testid=milestone-delete-dialog-confirm]')`)
          await waitDialogClosed(c, 'milestone-delete-dialog', '再確認後に削除')
          assert(rawMilestone(m2) === undefined, 'M2を削除')

          // タスクありのM1: 所属タスクを選択・編集中に削除 → 確認に未保存の変更 → 削除後は詳細をプロジェクトに戻す
          await c.click(`document.querySelector('[data-testid=task-list] [data-task-id="${m1a}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, 'M1のタスクの詳細')
          await c.setInput('[data-testid=task-editor] input:not([type=hidden])', 'M1の未完了（ドラフト）')
          await openMenu(m1)
          await waitDialog(c, 'milestone-delete-dialog', 'M1の確認')
          text = await dialogText(c, 'milestone-delete-dialog')
          assert(text.includes('「M1」') && text.includes('所属するタスク: 2 件') && (await c.evaluate(`!!document.querySelector('[data-testid=milestone-delete-dialog-draft]')`)), '名前・総数・未保存の変更', text)
          await c.click(`document.querySelector('[data-testid=milestone-delete-dialog-confirm]')`)
          await waitDialogClosed(c, 'milestone-delete-dialog', 'M1を削除')
          await c.waitFor(`document.querySelector('#detail-panel [data-testid=project-detail]')`, 3000, '詳細はプロジェクトへ戻る')
          for (const id of [m1a, m1b, m2done, added]) {
            const row = rawTask(id)
            assert(row && row.project_id === ids.mp && row.milestone_id === null && row.hidden_at !== null, 'タスクは残り、project_id 維持・milestone_id NULL・非表示', row)
          }
          assert(rawTask(m1a).title === 'M1の未完了' && rawTask(m1a).completed_at === null && rawTask(m1b).completed_at !== null, 'タイトル・完了状態は変えない（ドラフトは保存しない）')

          // 最後のマイルストンを削除した後: カードはなく、NEW MILESTONE だけ。タスクの追加・紐付けはできない（作り直さない）
          const board = await c.evaluate(`({ cards: document.querySelectorAll('[data-testid=milestone-card]').length, note: !!document.querySelector('[data-testid=no-milestone-note]'), newTask: !!document.querySelector('[data-testid^=new-task-]'), newMilestone: document.querySelector('[data-testid=new-milestone-button]')?.disabled })`)
          assert(board.cards === 0 && !board.note && !board.newTask && board.newMilestone === false, '0件: NEW MILESTONE を表示し、タスクは追加できない', board)
          assert((await milestones(c)).filter((m) => m.projectId === ids.mp).length === 0, '自動で作り直さない')
          const rejected = await apiRaw(c, `window.gtd.tasks.create({ title: 'x', projectId: ${JSON.stringify(ids.mp)} })`)
          assert(!rejected.ok && rejected.error.code === 'INVALID_INPUT', 'プロジェクトだけの指定は拒否', rejected)
          // 非表示のタスクは、Inbox・検索・件数・バッジに出ない
          await openInbox(c)
          assert((await badge(c)) === badgeBefore, 'バッジは変わらない', { before: badgeBefore, after: await badge(c) })
          await c.click(c.byText('button', 'すべて'))
          await c.setInput('input[aria-label="タイトルで絞り込み"]', 'M1')
          await sleep(300)
          assert((await listIds(c)).length === 0, 'Inboxの検索にも出ない', await listIds(c))
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '')
          const inboxTask = (await tasks(c)).find((x) => x.projectId === null)
          assert(inboxTask && !(await tasks(c)).some((x) => [m1a, m1b, m2done, added].includes(x.id)), '一覧APIにも出ない（通常のInboxタスクは出る）')
          // 紐付けメニュー: 0件のプロジェクトは選べない
          await c.click(`document.querySelector('[data-assign-task-id]')`)
          await c.waitFor(`document.querySelector('[role=menu] [data-assign-project-id="${ids.mp}"]')`, 3000, '紐付けメニュー')
          const assignItem = await c.evaluate(`document.querySelector('[role=menu] [data-assign-project-id="${ids.mp}"]').getAttribute('aria-disabled')`)
          assert(assignItem === 'true', 'マイルストン0件のプロジェクトへは紐付けできない', assignItem)
          await c.key('Escape', 27)
          await c.waitFor(`!document.querySelector('[role=menu]')`, 3000, 'メニューを閉じる')
          // 詳細パネルの所属の選択肢も選べない
          await clickRowShowDetail(c, `document.querySelector('[data-testid=task-list] [role=option]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-project-select]')`, 3000, '詳細')
          const option = await c.evaluate(`[...document.querySelector('[data-testid=task-project-select]').options].filter((o) => o.textContent.startsWith('マイルストンの削除')).map((o) => ({ disabled: o.disabled, text: o.textContent }))`)
          assert(option.length === 1 && option[0].disabled && option[0].text.includes('マイルストンがありません'), '詳細の所属でも選べない', option)
          // 非表示になった未完了タスク（M1の未完了）はプロジェクトの完了を妨げない
          await openProject(c, ids.mp)
          await c.click(`document.querySelector('#detail-panel [data-testid=project-completion-button]')`)
          await c.waitFor(`document.querySelector('[data-testid=project-status]')?.textContent.startsWith('完了済み')`, 5000, '完了')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      'プロジェクトの削除: 右の詳細から（未完了・完了済み）、件数（既に非表示のタスクを含む）と「残るが表示されない」を確認、取消、確認中の件数変化、成功後はInboxへ・サイドバーから除外・配下は非表示、他のプロジェクト・Inboxは変えない',
      () =>
        withApp({ label: 'delete-projects', userDataDir: dir }, async (app) => {
          const c = app.cdp
          ids.q = (await api(c, `window.gtd.projects.create({ name: '削除するプロジェクト' })`)).id
          ids.r = (await api(c, `window.gtd.projects.create({ name: '関係のないプロジェクト' })`)).id
          const qm = await firstMilestoneId(c, ids.q)
          const rm = await firstMilestoneId(c, ids.r)
          const q1 = await createTask(c, 'Qのタスク', ids.q, qm)
          // 先にマイルストンの削除で非表示にしたタスク（project_id だけが残る）
          const qm2 = (await api(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(ids.q)}, name: '先に消す' })`)).id
          const q2 = await createTask(c, 'Qの非表示タスク', ids.q, qm2)
          await api(c, `window.gtd.milestones.delete({ id: ${JSON.stringify(qm2)}, expectedTaskCount: 1 })`)
          const hiddenAtBefore = rawTask(q2).hidden_at
          const r1 = await createTask(c, 'Rのタスク', ids.r, rm)
          const i1 = await createTask(c, 'Inboxのタスク')
          const untouched = { r1: rawTask(r1), i1: rawTask(i1), rm: rawMilestone(rm) }
          await reload(c)
          const badgeBefore = await badge(c)
          await openProject(c, ids.q)
          // プロジェクト名の未保存の編集（削除すると失われることを示す）
          await c.click(`document.querySelector('button[aria-label="プロジェクト名を変更"]')`)
          await c.waitFor(`document.querySelector('[data-testid=project-name-editor] input')`, 3000, '名前の編集')
          await c.setInput('[data-testid=project-name-editor] input', '削除するプロジェクト（未保存）')

          await c.click(`document.querySelector('#detail-panel [data-testid=project-delete-button]')`)
          await waitDialog(c, 'project-delete-dialog', '確認')
          let text = await dialogText(c, 'project-delete-dialog')
          assert(
            text.includes('「削除するプロジェクト」') &&
              text.includes('マイルストン: 1 件、タスク: 2 件') &&
              text.includes('既に表示されていないタスク 1 件') &&
              text.includes('配下のマイルストン・タスクは削除されずに残りますが、画面には表示されなくなります') &&
              (await c.evaluate(`!!document.querySelector('[data-testid=project-delete-dialog-draft]')`)),
            '名前・マイルストン数・タスク総数・残るが表示されない・未保存の変更',
            text
          )
          await c.click(`document.querySelector('[data-testid=project-delete-dialog-cancel]')`)
          await waitDialogClosed(c, 'project-delete-dialog', 'キャンセル')
          assert((await projects(c)).some((p) => p.id === ids.q) && (await c.evaluate(`document.querySelector('[data-testid=project-name-editor] input')?.value`)) === '削除するプロジェクト（未保存）', 'キャンセルなら何も変えない（入力も保持）')

          // 確認中に件数が変わった → 再確認
          await c.click(`document.querySelector('#detail-panel [data-testid=project-delete-button]')`)
          await waitDialog(c, 'project-delete-dialog', '確認（件数変化）')
          const q3 = await createTask(c, '確認中に追加', ids.q, qm)
          await c.click(`document.querySelector('[data-testid=project-delete-dialog-confirm]')`)
          await c.waitFor(`document.querySelector('[data-testid=project-delete-dialog-notice]')`, 5000, '再確認')
          text = await dialogText(c, 'project-delete-dialog')
          assert(text.includes('タスク: 3 件') && (await projects(c)).some((p) => p.id === ids.q), '削除せず、件数を更新して再確認', text)
          await c.click(`document.querySelector('[data-testid=project-delete-dialog-confirm]')`)
          await c.waitFor(`location.hash === '#/inbox'`, 5000, '削除後はInboxへ')
          await sleep(500)
          assert((await anyDialog(c)) === null, '削除した対象の未保存の確認は出ない', await anyDialog(c))
          const after = await c.evaluate(`({ inSidebar: !!document.querySelector('[data-testid=project-list] [data-project-id="${ids.q}"]'), other: !!document.querySelector('[data-testid=project-list] [data-project-id="${ids.r}"]'), list: [...document.querySelectorAll('[data-testid=task-list] [role=option]')].map((e) => e.dataset.taskId) })`)
          assert(!after.inSidebar && after.other && JSON.stringify(after.list) === JSON.stringify([i1, ids.inbox]), 'サイドバーから除外し、配下のタスクはInboxに出ない（通常のInboxタスクは表示）', after)
          assert((await badge(c)) === badgeBefore, 'バッジは変わらない（非表示のタスクを数えない）', { badgeBefore, after: await badge(c) })
          readDb(dbFile, (db) => {
            assert(!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(ids.q), 'プロジェクトは物理削除')
            const m = db.prepare('SELECT * FROM milestones WHERE id = ?').get(qm)
            assert(m && m.project_id === null && m.name === '新しいマイルストン', 'マイルストンは残り project_id = NULL', m)
            for (const id of [q1, q2, q3]) {
              const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
              assert(row && row.project_id === null && row.milestone_id === null && row.hidden_at !== null, 'タスクは残り、所属なし・非表示', row)
            }
            assert(db.prepare('SELECT hidden_at FROM tasks WHERE id = ?').get(q2).hidden_at === hiddenAtBefore, '既に非表示のタスクも処理し、最初の非表示日時を保つ')
            assert(JSON.stringify(db.prepare('SELECT * FROM tasks WHERE id = ?').get(r1)) === JSON.stringify(untouched.r1), '他のプロジェクトのタスクは変えない')
            assert(JSON.stringify(db.prepare('SELECT * FROM tasks WHERE id = ?').get(i1)) === JSON.stringify(untouched.i1), 'Inboxのタスクは変えない')
            assert(JSON.stringify(db.prepare('SELECT * FROM milestones WHERE id = ?').get(rm)) === JSON.stringify(untouched.rm), '他のプロジェクトのマイルストンは変えない')
          })
          assert(!(await milestones(c)).some((m) => m.id === qm), 'マイルストン一覧にも出ない')

          // 完了済みのプロジェクト（前のシナリオで完了）も削除できる
          await openProject(c, ids.mp)
          assert((await c.evaluate(`document.querySelector('[data-testid=project-status]')?.textContent`)).startsWith('完了済み'), '完了済み')
          await c.click(`document.querySelector('#detail-panel [data-testid=project-delete-button]')`)
          await waitDialog(c, 'project-delete-dialog', '完了済みの確認')
          assert((await dialogText(c, 'project-delete-dialog')).includes('（完了済み）'), '完了済みであることを示す')
          await c.click(`document.querySelector('[data-testid=project-delete-dialog-confirm]')`)
          await c.waitFor(`location.hash === '#/inbox'`, 5000, '完了済みを削除してInboxへ')
          assert(!(await projects(c)).some((p) => p.id === ids.mp), '完了済みのプロジェクトも削除')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      '再起動: 削除由来の非表示データは物理削除されず、非表示のまま（Inbox・一覧・プロジェクトに出ない）',
      async () => {
        const before = readDb(dbFile, (db) => ({
          hidden: db.prepare('SELECT id, hidden_at, project_id, milestone_id FROM tasks WHERE hidden_at IS NOT NULL ORDER BY id').all(),
          detached: db.prepare('SELECT id FROM milestones WHERE project_id IS NULL ORDER BY id').all()
        }))
        assert(before.hidden.length >= 7 && before.detached.length >= 1, '非表示のデータがある', before)
        await withApp({ label: 'deletion-restart', userDataDir: dir }, async (app) => {
          const c = app.cdp
          const visible = (await tasks(c)).map((t) => t.id)
          assert(!before.hidden.some((row) => visible.includes(row.id)), '再起動後も表示しない')
          assert(!(await milestones(c)).some((m) => before.detached.some((row) => row.id === m.id)), 'マイルストンも表示しない')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
        const after = readDb(dbFile, (db) => ({
          hidden: db.prepare('SELECT id, hidden_at, project_id, milestone_id FROM tasks WHERE hidden_at IS NOT NULL ORDER BY id').all(),
          detached: db.prepare('SELECT id FROM milestones WHERE project_id IS NULL ORDER BY id').all()
        }))
        assert(JSON.stringify(after) === JSON.stringify(before), '再起動で物理削除しない（一度限りの移行は再実行されない）', after)
      }
    ],
    [
      '移行（5.5 → 5.6）: プロジェクトだけに所属するタスク（完了済みを含む）だけを削除し、Inbox・マイルストン所属済みは保持',
      async () => {
        const file = join(migrationDir, 'gtd.sqlite')
        const old = await createDatabaseAt(file, 6) // 0000〜0005（フェーズ5.5まで）
        const p = randomUUID()
        const m = randomUUID()
        const T = Array.from({ length: 5 }, () => randomUUID())
        old.prepare('INSERT INTO projects (id, name, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, NULL)').run(p, '移行のプロジェクト', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')
        old.prepare('INSERT INTO milestones (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(m, p, '移行のM', '2026-11-01T00:00:01.000Z', '2026-11-01T00:00:01.000Z')
        const insert = old.prepare('INSERT INTO tasks (id, title, created_at, updated_at, completed_at, project_id, milestone_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        insert.run(T[0], 'プロジェクトだけ', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z', null, p, null)
        insert.run(T[1], 'プロジェクトだけ（完了済み）', '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z', '2026-11-03T01:00:00.000Z', p, null)
        insert.run(T[2], 'マイルストン所属', '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z', null, p, m)
        insert.run(T[3], 'Inbox', '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z', null, null, null)
        insert.run(T[4], 'Inbox（完了済み）', '2026-11-06T00:00:00.000Z', '2026-11-06T00:00:00.000Z', '2026-11-06T01:00:00.000Z', null, null)
        const keep = old.prepare('SELECT * FROM tasks WHERE id IN (?, ?, ?) ORDER BY id').all(T[2], T[3], T[4])
        old.close()
        await withApp({ label: 'migration-56', userDataDir: migrationDir }, async (app) => {
          const c = app.cdp
          // フェーズ5.9で 0007（手動順）、フェーズ6で 0008（期限）、TaskRow で 0009（お気に入り）が加わったため、0006〜0009 を適用する
          assert(app.logs.some((line) => line.includes('migrations applied: 6 -> 10')), '0006〜0009を適用する', app.logs.filter((l) => l.includes('[db]')))
          const visible = (await tasks(c)).map((t) => t.id).sort()
          assert(JSON.stringify(visible) === JSON.stringify([T[2], T[3], T[4]].sort()), '残したタスクだけを表示', visible)
          await openProject(c, p)
          const card = await c.evaluate(`[...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => [e.dataset.milestoneId, e.querySelectorAll('[role=option]').length])`)
          assert(JSON.stringify(card) === JSON.stringify([[m, 1]]), 'マイルストン所属のタスクはカードに表示', card)
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
        readDb(file, (db) => {
          assert(!db.prepare('SELECT 1 FROM tasks WHERE id IN (?, ?)').get(T[0], T[1]), 'プロジェクトだけに所属するタスクを削除（完了済みを含む）')
          const kept = db.prepare('SELECT * FROM tasks WHERE id IN (?, ?, ?) ORDER BY id').all(T[2], T[3], T[4])
          assert(JSON.stringify(kept) === JSON.stringify(keep.map((row) => ({ ...row, hidden_at: null, position: null, dueto: null, favorite: 0 }))), 'Inbox・マイルストン所属済みは全列そのまま（0007の手動順・0008の期限はNULL、0009のお気に入りは false）', kept)
          assert(db.prepare('SELECT COUNT(*) AS c FROM milestones').get().c === 1 && db.prepare('SELECT COUNT(*) AS c FROM projects').get().c === 1, 'プロジェクト・マイルストンは保持')
        })
      }
    ]
  ]
}
