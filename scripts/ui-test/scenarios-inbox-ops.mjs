// フェーズ5.9: Inboxの紐付け先ツリー・複数選択・ドラッグ＆ドロップの一括紐付け・確認なしの削除・インライン編集のUIシナリオ。
// run.mjs から呼ぶ。すべて専用の一時userData（root配下）だけを使う。事前データは一時DBへ直接用意する（アプリの起動前）。
import { join } from 'node:path'
import {
  assert,
  clickWith,
  createDatabaseAt,
  doubleClick,
  keyWith,
  MOD,
  mouseDown,
  mouseMoveTo,
  mouseUp,
  openDatabaseReadOnly,
  pointOf,
  requestQuit,
  sleep
} from './lib.mjs'

// テスト用の固定ID（UUID v4 の形）
export const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (base, seconds) => new Date(Date.parse(base) + seconds * 1000).toISOString()

// 一時DBへ事前データを入れる（アプリの起動前だけ）
export async function seedDatabase(dir, { projects = [], milestones = [], tasks = [] }) {
  const db = await createDatabaseAt(join(dir, 'gtd.sqlite'))
  const insertProject = db.prepare('INSERT INTO projects (id, name, created_at, updated_at, done_on, done) VALUES (?, ?, ?, ?, ?, ?)')
  const insertMilestone = db.prepare('INSERT INTO milestones (id, project_id, name, created_at, updated_at, position) VALUES (?, ?, ?, ?, ?, ?)')
  const insertTask = db.prepare(
    'INSERT INTO tasks (id, title, created_at, updated_at, done_on, project_id, milestone_id, hidden_at, position, dueto, favorite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  db.transaction(() => {
    for (const p of projects) insertProject.run(p.id, p.name, p.createdAt, p.createdAt, p.doneOn ?? null, p.doneOn ? 1 : 0)
    for (const m of milestones) insertMilestone.run(m.id, m.projectId, m.name, m.createdAt, m.createdAt, m.position ?? null)
    for (const t of tasks) insertTask.run(t.id, t.title, t.createdAt, t.createdAt, t.doneOn ?? null, t.projectId ?? null, t.milestoneId ?? null, t.hiddenAt ?? null, t.position ?? null, t.dueto ?? null, t.favorite ? 1 : 0)
  })()
  db.close()
}

export function readDb(dir, sql, ...params) {
  const db = openDatabaseReadOnly(join(dir, 'gtd.sqlite'))
  try {
    return db.prepare(sql).all(...params)
  } finally {
    db.close()
  }
}

export const rowOf = (taskId) => `document.querySelector('[data-testid=task-list] [data-task-id="${taskId}"]')`
const titleOf = (taskId) => `document.querySelector('[data-testid=task-list] [data-task-id="${taskId}"] [data-testid=task-title]')`
const treeMilestone = (id) => `document.querySelector('[data-drop-milestone-id="${id}"]')`
const treeProject = (id) => `document.querySelector('[data-tree-project-id="${id}"]')`
const noDialog = `!document.querySelector('[role=dialog]')`

export function inboxOpsScenarios({ withApp, root }) {
  const dir = join(root, 'userData-inbox-ops')
  const deleteDir = join(root, 'userData-inbox-delete')
  const editDir = join(root, 'userData-inline-edit')
  const BASE = '2026-11-01T00:00:00.000Z'
  // プロジェクト: P1「案件」（M1 設計・M2 実装）、P2「案件」（同名。M3 設計＝同名のマイルストン）、P3（マイルストンなし）、P4（完了済み）
  // 同名の区別（作成日時・IDの先頭8文字）を確かめるため、プロジェクト・マイルストンのIDは先頭を変える
  const P1 = 'a1000000-0000-4000-8000-000000001001'
  const P2 = 'b2000000-0000-4000-8000-000000001002'
  const P3 = 'c3000000-0000-4000-8000-000000001003'
  const P4 = 'd4000000-0000-4000-8000-000000001004'
  const M1 = 'e1000000-0000-4000-8000-000000002001'
  const M2 = 'e2000000-0000-4000-8000-000000002002'
  const M3 = 'e3000000-0000-4000-8000-000000002003'
  const M5 = 'e5000000-0000-4000-8000-000000002005'
  const T = (i) => U(i)

  const api = (c, expression) =>
    c.evaluate(`(${expression}).then((r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data })`)
  const waitInbox = async (c) => {
    await c.waitFor(`location.hash === '#/inbox' && document.querySelector('[data-testid=task-list] [role=option]')`, 10000, 'Inbox')
    await sleep(300)
  }
  const reload = async (c) => {
    await c.evaluate('location.reload()')
    await c.waitFor(`document.querySelector('nav button[aria-label="Inbox"]')`, 10000, '再読み込み')
    await sleep(400)
  }
  const selectedIds = (c) =>
    c.evaluate(`[...document.querySelectorAll('[data-testid=task-list] [role=option][aria-selected=true]')].map((e) => e.dataset.taskId)`)
  const assignedTo = (taskIds) =>
    readDb(dir, `SELECT id, project_id, milestone_id, position FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')}) ORDER BY id`, ...taskIds)
  const inboxCount = () => readDb(dir, 'SELECT COUNT(*) AS n FROM tasks WHERE project_id IS NULL AND hidden_at IS NULL')[0].n
  const panel = (c) => c.evaluate(`document.querySelector('[data-inbox-panel]')?.dataset.inboxPanel ?? null`)
  const noOutOfScope = `!document.querySelector('[data-testid=selected-out-of-scope], [data-testid=detail-out-of-scope]') && !document.body.innerText.includes('この一覧の対象外')`

  // 行を掴んで（しきい値を超えて）動かし、指定の要素の上へ運ぶ。release なら離す
  const dragRow = async (c, taskId, targetExpr, { release = true } = {}) => {
    const from = await pointOf(c, rowOf(taskId), { rx: 0.35 })
    await mouseDown(c, from)
    await mouseMoveTo(c, from, { x: from.x + 12, y: from.y + 4 }, 3)
    await c.waitFor(`document.querySelector('[data-testid=task-drag-preview]')`, 2000, 'ドラッグ中の表示')
    const to = await pointOf(c, targetExpr, { scroll: false })
    await mouseMoveTo(c, { x: from.x + 12, y: from.y + 4 }, to, 10)
    await sleep(120)
    if (release) await mouseUp(c, to)
    return to
  }
  const preview = (c) =>
    c.evaluate(
      `(() => { const p = document.querySelector('[data-testid=task-drag-preview]'); return p ? { state: p.dataset.dragState, count: Number(p.dataset.dragCount), text: p.textContent } : null })()`
    )

  return [
    [
      'Inbox（5.9）: 紐付け先ツリー・右サイドバーの切り替え・複数選択（⌘・Shift・キーボード・絞り込み）',
      async () => {
        await seedDatabase(dir, {
          projects: [
            { id: P1, name: '案件', createdAt: at(BASE, 1) },
            { id: P2, name: '案件', createdAt: at(BASE, 2) },
            { id: P3, name: '空の案件', createdAt: at(BASE, 3) },
            { id: P4, name: '完了した案件', createdAt: at(BASE, 4), doneOn: at(BASE, 5) }
          ],
          milestones: [
            { id: M1, projectId: P1, name: '設計', createdAt: at(BASE, 10) },
            { id: M2, projectId: P1, name: '実装', createdAt: at(BASE, 11) },
            { id: M3, projectId: P2, name: '設計', createdAt: at(BASE, 12) },
            { id: M5, projectId: P4, name: '完了側', createdAt: at(BASE, 13) }
          ],
          // Inbox 30件（作成日時の新しい順で表示される: T30 … T1）
          tasks: Array.from({ length: 30 }, (_, i) => ({ id: T(i + 1), title: `Inbox ${String(i + 1).padStart(2, '0')}`, createdAt: at(BASE, 100 + i) }))
        })
        await withApp({ label: 'inbox-tree', userDataDir: dir }, async (app) => {
          const c = app.cdp
          await waitInbox(c)
          // 右サイドバーは紐付け先（Inboxに入った時の既定）
          assert((await panel(c)) === 'targets', 'Inboxに入ると紐付け先を表示', await panel(c))
          const tree = await c.evaluate(`(() => ({
            projects: [...document.querySelectorAll('[data-testid=assign-target-project]')].map((e) => e.dataset.projectId),
            labels: [...document.querySelectorAll('[data-tree-project-id]')].map((e) => e.getAttribute('aria-label')),
            milestones: [...document.querySelectorAll('[data-drop-milestone-id]')].map((e) => ({ id: e.dataset.dropMilestoneId, label: e.dataset.dropLabel })),
            emptyBlocked: document.querySelector('[data-tree-project-id="${P3}"]')?.closest('li')?.querySelector('[data-testid=assign-target-empty]')?.dataset.dropBlocked ?? null,
            projectBlocked: document.querySelector('[data-tree-project-id="${P1}"]')?.dataset.dropBlocked ?? null
          }))()`)
          assert(!tree.projects.includes(P4), '完了済みのプロジェクトは表示しない', tree)
          assert([P1, P2, P3].every((id) => tree.projects.includes(id)), '未完了のプロジェクトを表示', tree)
          assert(!tree.milestones.some((m) => m.id === M5), '完了済みのマイルストンはドロップ先にしない', tree)
          const sameName = tree.milestones.filter((m) => m.id === M1 || m.id === M3).map((m) => m.label)
          assert(sameName.length === 2 && sameName[0] !== sameName[1] && sameName.every((l) => l.includes('ID')), '同名のプロジェクト・マイルストンを区別できる', sameName)
          assert(tree.emptyBlocked !== null && tree.projectBlocked !== null, 'マイルストン0件のプロジェクト・プロジェクト自体はドロップ先にしない', tree)
          // 展開・折りたたみ
          await c.click(treeProject(P1))
          assert((await c.evaluate(`${treeProject(P1)}.getAttribute('aria-expanded')`)) === 'false' && !(await c.evaluate(`!!${treeMilestone(M1)}`)), '折りたたむとマイルストンを隠す')
          await c.click(treeProject(P1))
          assert(await c.evaluate(`!!${treeMilestone(M1)}`), '展開するとマイルストンを表示')

          // 行のクリックは選択だけ（詳細へ自動で切り替えない）
          await c.click(rowOf(T(25)))
          assert((await panel(c)) === 'targets' && (await selectedIds(c)).join() === T(25), 'クリックは単一選択（紐付け先のまま）', { panel: await panel(c), sel: await selectedIds(c) })
          // Enter（明示的な操作）で詳細へ
          await c.focus('[data-testid=task-list]')
          await c.enter()
          await c.waitFor(`document.querySelector('[data-inbox-panel=detail] [data-testid=task-editor]')`, 3000, 'Enter で詳細を表示')
          await c.click(`document.querySelector('[data-testid=inbox-panel-tab-targets]')`)
          await c.waitFor(`document.querySelector('[data-inbox-panel=targets] [data-testid=assign-target-tree]')`, 3000, 'タブで紐付け先へ戻す')

          // ⌘+クリックで追加・解除、Shift+クリックで範囲（表示順: T30, T29, …）
          await clickWith(c, rowOf(T(23)), MOD.meta)
          assert((await selectedIds(c)).sort().join() === [T(23), T(25)].sort().join(), '⌘+クリックで追加', await selectedIds(c))
          await clickWith(c, rowOf(T(20)), MOD.shift)
          assert((await selectedIds(c)).sort().join() === [T(20), T(21), T(22), T(23)].sort().join(), 'Shift+クリックで基準行（最後に⌘した行）から範囲選択', await selectedIds(c))
          await c.waitFor(`document.querySelector('[data-testid=selection-count]')?.textContent === '4 件選択中'`, 2000, '選択件数の表示')
          await clickWith(c, rowOf(T(21)), MOD.meta)
          assert((await selectedIds(c)).length === 3, '⌘+クリックで解除')
          // キーボード: Esc で解除、Shift+↓ で範囲、X で追加・解除、⌘A ですべて
          await c.focus('[data-testid=task-list]')
          await keyWith(c, 'Escape', 27)
          assert((await selectedIds(c)).length === 0, 'Esc で選択解除')
          await keyWith(c, 'Home', 36)
          await keyWith(c, 'ArrowDown', 40, MOD.shift)
          await keyWith(c, 'ArrowDown', 40, MOD.shift)
          assert((await selectedIds(c)).sort().join() === [T(30), T(29), T(28)].sort().join(), 'Shift+↓ で範囲選択', await selectedIds(c))
          await keyWith(c, 'ArrowDown', 40)
          await keyWith(c, 'x', 88)
          assert((await selectedIds(c)).includes(T(27)) && (await selectedIds(c)).length === 4, 'X で現在行を追加', await selectedIds(c))
          await keyWith(c, 'a', 65, MOD.meta)
          // 描画されている行は仮想化で一部だけのため、件数は選択件数の表示で確かめる
          await c.waitFor(`document.querySelector('[data-testid=selection-count]')?.textContent === '30 件選択中'`, 2000, '⌘A で表示中のタスクをすべて選択（30件）')
          // 絞り込みで表示対象から外れたIDは選択から外す
          await c.setInput('input[aria-label="タイトルで絞り込み"]', 'Inbox 1')
          await c.waitFor(`document.querySelector('[data-testid=selection-count]')?.textContent === '10 件選択中'`, 3000, '絞り込み後の選択件数（Inbox 10〜19）')
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '')
          await sleep(300)
          // 行の高さ（2行構成）により描画される行は一部のため、選択件数の表示で確かめる
          const restored = await c.evaluate(`document.querySelector('[data-testid=selection-count]')?.textContent`)
          assert(restored === '10 件選択中', '絞り込みを戻しても、外れたIDは選択に戻らない', restored)
          // 仮想化: 描画外にスクロールしても選択は残る
          await c.evaluate(`document.querySelector('[data-testid=task-list-scroll]').scrollTop = 99999`)
          await sleep(200)
          await c.evaluate(`document.querySelector('[data-testid=task-list-scroll]').scrollTop = 0`)
          await sleep(200)
          assert((await c.evaluate(`document.querySelector('[data-testid=selection-count]')?.textContent`)) === '10 件選択中', '仮想化で行が入れ替わっても選択は失わない')
          await c.click(`document.querySelector('[data-testid=selection-clear]')`)
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ],
    [
      'Inbox（5.9）: ドラッグ＆ドロップで紐付け（選択集合・未選択の1件・不可の表示・Esc・領域外・途中削除・完了済み）',
      () =>
        withApp({ label: 'inbox-dnd', userDataDir: dir }, async (app) => {
          const c = app.cdp
          await waitInbox(c)
          // 選択済みの行をドラッグ → 選択集合（3件）をまとめて移す
          await c.click(rowOf(T(30)))
          await clickWith(c, rowOf(T(28)), MOD.shift)
          await dragRow(c, T(29), treeMilestone(M1), { release: false })
          let p = await preview(c)
          assert(p?.state === 'target' && p.count === 3 && p.text.includes('3 件') && p.text.includes('設計'), 'ドラッグ中に対象件数とドロップ先を表示', p)
          const over = await c.evaluate(`${treeMilestone(M1)}.style.outline !== '' || getComputedStyle(${treeMilestone(M1)}).outlineStyle !== 'none'`)
          assert(over, 'ドロップ先を強調表示')
          await mouseUp(c, await pointOf(c, treeMilestone(M1), { scroll: false }))
          await c.waitFor(`!${rowOf(T(30))} && !${rowOf(T(29))} && !${rowOf(T(28))}`, 5000, '紐付けた行はInboxから消える')
          let saved = assignedTo([T(28), T(29), T(30)])
          assert(saved.every((t) => t.project_id === P1 && t.milestone_id === M1), '3件とも P1 › 設計 に保存', saved)
          assert(inboxCount() === 27, 'Inboxは27件', inboxCount())
          assert((await selectedIds(c)).length === 0, '移したタスクは選択から外す')
          assert(await c.evaluate(noOutOfScope), '「対象外です」の表示を出さない')
          await c.waitFor(`document.querySelector('[data-testid=status-center]')?.textContent?.includes('全 27 件')`, 3000, '件数の更新')

          // 未選択の行をドラッグ → その1件だけ（選択は変えない）
          await c.click(rowOf(T(27)))
          await clickWith(c, rowOf(T(26)), MOD.meta)
          await dragRow(c, T(24), treeMilestone(M2), { release: false })
          p = await preview(c)
          assert(p?.count === 1 && p.text.includes('Inbox 24'), '未選択の行はその1件だけ', p)
          await mouseUp(c, await pointOf(c, treeMilestone(M2), { scroll: false }))
          await c.waitFor(`!${rowOf(T(24))}`, 5000, '1件だけ移る')
          assert(assignedTo([T(24)])[0].milestone_id === M2 && assignedTo([T(26), T(27)]).every((t) => t.project_id === null), '未選択の1件だけを保存', assignedTo([T(24), T(26), T(27)]))
          assert((await selectedIds(c)).sort().join() === [T(26), T(27)].sort().join(), '選択はそのまま', await selectedIds(c))

          // ドロップできない場所: プロジェクトの行・マイルストン0件 → 不可を表示し、離しても保存しない
          const before = readDb(dir, 'SELECT id, project_id, milestone_id, updated_at FROM tasks ORDER BY id')
          await dragRow(c, T(27), treeProject(P1), { release: false })
          p = await preview(c)
          assert(p?.state === 'blocked' && p.text.includes('ドロップできません'), 'プロジェクトの行は不可（理由を表示）', p)
          const empty = `document.querySelector('[data-tree-project-id="${P3}"]').closest('li').querySelector('[data-testid=assign-target-empty]')`
          await mouseMoveTo(c, await pointOf(c, treeProject(P1), { scroll: false }), await pointOf(c, empty, { scroll: false }), 5)
          p = await preview(c)
          assert(p?.state === 'blocked' && p.text.includes('マイルストンがありません'), 'マイルストン0件のプロジェクトは不可', p)
          await mouseUp(c, await pointOf(c, empty, { scroll: false }))
          // Esc で取り消し
          await dragRow(c, T(27), treeMilestone(M1), { release: false })
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=task-drag-preview]')`, 2000, 'Esc でドラッグを取り消す')
          await mouseUp(c, await pointOf(c, treeMilestone(M1), { scroll: false }))
          // 領域外（一覧の上）で離す
          await dragRow(c, T(27), `document.querySelector('[data-testid=view-search]')`)
          await sleep(300)
          assert(JSON.stringify(readDb(dir, 'SELECT id, project_id, milestone_id, updated_at FROM tasks ORDER BY id')) === JSON.stringify(before), '不可・Esc・領域外では保存しない')
          assert((await selectedIds(c)).length === 2, 'ドラッグの取り消し後も選択は残る')

          // ドラッグ開始後に移動先が削除された → Mainで拒否し、行と選択を残して理由を表示する
          await dragRow(c, T(27), treeMilestone(M2), { release: false })
          const m2Count = readDb(dir, 'SELECT COUNT(*) AS n FROM tasks WHERE milestone_id = ?', M2)[0].n
          await api(c, `window.gtd.milestones.delete({ id: ${JSON.stringify(M2)}, expectedTaskCount: ${m2Count} })`)
          await mouseUp(c, await pointOf(c, treeMilestone(M2), { scroll: false }))
          await c.waitFor(`document.querySelector('[data-testid=assign-error]')`, 5000, '失敗の表示')
          const error1 = await c.evaluate(`document.querySelector('[data-testid=assign-error]').textContent`)
          assert(error1.includes('見つかりません'), '理由を表示', error1)
          assert((await c.evaluate(`!!${rowOf(T(27))} && !!${rowOf(T(26))}`)) && (await selectedIds(c)).length === 2, '失敗時は行と選択を保持')
          assert(assignedTo([T(26), T(27)]).every((t) => t.project_id === null), '何も変更しない（全体ロールバック）')
          await c.click(`document.querySelector('[data-testid=assign-error] button')`)

          // ドラッグ開始後に移動先のプロジェクトが完了された → 拒否
          await dragRow(c, T(27), treeMilestone(M3), { release: false })
          await api(c, `window.gtd.projects.setCompleted({ id: ${JSON.stringify(P2)}, completed: true })`)
          await mouseUp(c, await pointOf(c, treeMilestone(M3), { scroll: false }))
          await c.waitFor(`document.querySelector('[data-testid=assign-error]')?.textContent.includes('完了済み')`, 5000, '完了済みへの紐付けを拒否')
          assert(assignedTo([T(26), T(27)]).every((t) => t.project_id === null), '何も変更しない（完了済み）')
          await c.click(`document.querySelector('[data-testid=assign-error] button')`)
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
    ],
    [
      'Inbox（5.9）: キーボードで複数タスクをまとめて紐付け・右詳細に表示中のタスクを移した後の状態',
      () =>
        withApp({ label: 'inbox-keyboard-assign', userDataDir: dir }, async (app) => {
          const c = app.cdp
          await waitInbox(c)
          // 直前のシナリオの変更（M2 削除・P2 完了）を反映済みの状態から
          const remaining = await c.evaluate(`[...document.querySelectorAll('[data-testid=task-list] [role=option]')].slice(0, 3).map((e) => e.dataset.taskId)`)
          await c.focus('[data-testid=task-list]')
          await keyWith(c, 'Home', 36)
          await keyWith(c, 'x', 88)
          await keyWith(c, 'ArrowDown', 40)
          await keyWith(c, 'x', 88)
          await keyWith(c, 'm', 77)
          await c.waitFor(`document.querySelector('[data-testid=assign-menu] [role=menu]')?.contains(document.activeElement)`, 3000, 'M で紐付けメニュー')
          await sleep(150)
          const heading = await c.evaluate(`document.querySelector('[data-testid=assign-menu]').textContent`)
          assert(heading.includes('選択した 2 件'), 'メニューに対象件数を示す', heading)
          const projectId = await c.evaluate(`document.activeElement.dataset.assignProjectId`)
          await c.enter()
          await c.waitFor(`document.activeElement?.dataset?.assignMilestoneId`, 3000, 'マイルストンの選択へ')
          await sleep(150)
          const milestoneId = await c.evaluate(`document.activeElement.dataset.assignMilestoneId`)
          await c.enter()
          await c.waitFor(`!${rowOf(remaining[0])} && !${rowOf(remaining[1])}`, 5000, 'キーボードで2件を紐付け')
          const saved = assignedTo(remaining.slice(0, 2))
          assert(projectId === P1 && milestoneId === M1 && saved.every((t) => t.project_id === P1 && t.milestone_id === M1), 'キーボードで選んだ紐付け先に保存', { projectId, milestoneId, saved })
          // 現在行は残っている近くのタスクへ移る
          const active = await c.evaluate(`document.querySelector('[data-testid=task-list]').getAttribute('aria-activedescendant')`)
          assert(active === `task-option-${remaining[2]}`, '現在行は近くの残りのタスクへ', { active, expected: remaining[2] })

          // 右の詳細に表示中のタスクを M キーで移す → 選択を解除し、「対象外」の表示を出さない
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`document.querySelector('[data-inbox-panel=detail] [data-testid=task-editor]')`, 3000, '詳細を表示')
          await c.focus('[data-testid=task-list]')
          await keyWith(c, 'm', 77)
          await c.waitFor(`document.querySelector('[data-testid=assign-menu] [role=menu]')?.contains(document.activeElement)`, 3000, 'メニュー')
          await sleep(150)
          await c.enter()
          await c.waitFor(`document.activeElement?.dataset?.assignMilestoneId`, 3000, 'マイルストンの選択へ')
          await sleep(150)
          await c.enter()
          await c.waitFor(`!${rowOf(remaining[2])}`, 5000, '詳細に表示中のタスクを紐付け')
          await sleep(300)
          assert(await c.evaluate(`!document.querySelector('[data-testid=task-editor]')`), '詳細の表示を閉じる（選択解除）')
          assert(await c.evaluate(noOutOfScope), '「この一覧の対象外です」を表示しない')

          // ドラッグでも同じ（詳細に表示中のタスクを移す）
          const next = await c.evaluate(`document.querySelector('[data-testid=task-list] [role=option]').dataset.taskId`)
          await c.click(rowOf(next))
          await c.focus('[data-testid=task-list]')
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, '詳細を表示')
          await dragRow(c, next, treeMilestone(M1))
          await c.waitFor(`!${rowOf(next)}`, 5000, 'ドラッグで紐付け')
          await sleep(300)
          assert(await c.evaluate(`!document.querySelector('[data-testid=task-editor]')`) && (await c.evaluate(noOutOfScope)), 'ドラッグ後も対象外の表示なし・選択解除')
          // 手動順のない M1 への追加は position が null のまま
          assert(assignedTo([next])[0].position === null, '手動順のないマイルストンでは作成日時の順に従う')
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
    ],
    [
      'Inbox・Project（5.9）: 削除は確認なし（単体・一括・メニュー・選択バー・カード）、入力中の Delete／Backspace では削除しない',
      async () => {
        const PX = U(3001)
        const MX = U(3101)
        await seedDatabase(deleteDir, {
          projects: [{ id: PX, name: '削除の案件', createdAt: at(BASE, 1) }],
          milestones: [{ id: MX, projectId: PX, name: 'M', createdAt: at(BASE, 2) }],
          tasks: [
            ...Array.from({ length: 12 }, (_, i) => ({ id: T(500 + i), title: `削除 ${i}`, createdAt: at(BASE, 200 + i) })),
            { id: T(600), title: 'カードの削除', createdAt: at(BASE, 300), projectId: PX, milestoneId: MX },
            { id: T(601), title: 'カードの残り', createdAt: at(BASE, 301), projectId: PX, milestoneId: MX }
          ]
        })
        const exists = (id) => readDb(deleteDir, 'SELECT COUNT(*) AS n FROM tasks WHERE id = ?', id)[0].n === 1
        const total = () => readDb(deleteDir, 'SELECT COUNT(*) AS n FROM tasks')[0].n
        // 削除の操作の間、確認ダイアログが一度も出ないこと
        const watchDialogs = (c) => c.evaluate(`(() => { window.__dialogSeen = false; const o = new MutationObserver(() => { if (document.querySelector('[role=dialog]')) window.__dialogSeen = true }); o.observe(document.body, { childList: true, subtree: true }); window.__dialogObserver = o; return true })()`)
        const dialogSeen = (c) => c.evaluate('window.__dialogSeen')
        await withApp({ label: 'delete-no-confirm', userDataDir: deleteDir }, async (app) => {
          const c = app.cdp
          await waitInbox(c)
          await watchDialogs(c)
          // Delete キー（単体）
          await c.click(rowOf(T(511)))
          await c.focus('[data-testid=task-list]')
          await keyWith(c, 'Delete', 46)
          await c.waitFor(`!${rowOf(T(511))}`, 5000, 'Delete で削除')
          assert(!exists(T(511)), 'DBから物理削除')
          // 行のメニュー（右クリック）から
          await c.evaluate(`${rowOf(T(510))}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))`)
          await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')?.contains(document.activeElement)`, 3000, '行のメニュー')
          await sleep(150)
          await c.click(`document.querySelector('[data-testid=task-row-menu-delete]')`)
          await c.waitFor(`!${rowOf(T(510))}`, 5000, 'メニューから削除')
          // 複数選択 → Delete で一括削除
          await c.click(rowOf(T(509)))
          await clickWith(c, rowOf(T(507)), MOD.shift)
          await c.focus('[data-testid=task-list]')
          await keyWith(c, 'Backspace', 8)
          await c.waitFor(`!${rowOf(T(509))} && !${rowOf(T(508))} && !${rowOf(T(507))}`, 5000, '選択した3件を一括削除')
          assert(![507, 508, 509].some((i) => exists(T(i))), 'DBから3件とも削除')
          // 選択バーの削除（件数を表示）
          await c.click(rowOf(T(506)))
          await clickWith(c, rowOf(T(505)), MOD.meta)
          const label = await c.evaluate(`document.querySelector('[data-testid=selection-delete]').textContent`)
          assert(label.includes('2 件を削除'), '一括削除の対象件数を表示', label)
          await c.click(`document.querySelector('[data-testid=selection-delete]')`)
          await c.waitFor(`!${rowOf(T(506))} && !${rowOf(T(505))}`, 5000, '選択バーから一括削除')
          // 文字入力中の Delete／Backspace では削除しない（追加欄・検索欄・インライン編集）
          const count = total()
          await c.click(rowOf(T(504)))
          await c.focus('input[aria-label="タスクのタイトル"]')
          await c.insertText('abc')
          await keyWith(c, 'Backspace', 8)
          await keyWith(c, 'Delete', 46)
          await c.focus('input[aria-label="タイトルで絞り込み"]')
          await c.insertText('x')
          await keyWith(c, 'Backspace', 8)
          await keyWith(c, 'Delete', 46)
          await doubleClick(c, titleOf(T(504)))
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=inline-title-editor] input')`, 3000, 'インライン編集')
          await keyWith(c, 'Backspace', 8)
          await keyWith(c, 'Delete', 46)
          await keyWith(c, 'Escape', 27)
          await sleep(300)
          assert(total() === count && exists(T(504)), '入力中の Delete／Backspace ではタスクを削除しない', { before: count, after: total() })
          // 別のタスクの詳細の未保存入力は残る。削除するタスク自身の未保存入力は確認なしで破棄
          await c.focus('[data-testid=task-list]')
          await c.click(rowOf(T(503)))
          await c.focus('[data-testid=task-list]')
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, '詳細')
          await c.setInput('[data-testid=task-editor] input:not([type=hidden])', '削除 3（未保存）')
          await c.evaluate(`${rowOf(T(502))}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))`)
          await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')?.contains(document.activeElement)`, 3000, '行のメニュー')
          await sleep(150)
          await c.click(`document.querySelector('[data-testid=task-row-menu-delete]')`)
          await c.waitFor(`!${rowOf(T(502))}`, 5000, '別のタスクを削除')
          assert((await c.evaluate(`document.querySelector('[data-testid=task-editor] input:not([type=hidden])')?.value`)) === '削除 3（未保存）', '他のタスクの未保存入力は残す')
          await c.evaluate(`${rowOf(T(503))}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))`)
          await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')?.contains(document.activeElement)`, 3000, '行のメニュー')
          await sleep(150)
          await c.click(`document.querySelector('[data-testid=task-row-menu-delete]')`)
          await c.waitFor(`!${rowOf(T(503))} && !document.querySelector('[data-testid=task-editor]')`, 5000, '詳細に表示中のタスクを削除（入力は確認なしで破棄）')
          assert(!exists(T(503)), '削除した')
          // プロジェクトのカードでも確認なし
          await c.evaluate(`location.hash = ${JSON.stringify(`#/projects/${PX}`)}`)
          await c.waitFor(`document.querySelector('[data-testid=milestone-board]') && ${rowOf(T(600))}`, 5000, 'カード')
          await c.click(rowOf(T(600)))
          await c.focus(`[data-card-list="group:${MX}"]`)
          await keyWith(c, 'Delete', 46)
          await c.waitFor(`!${rowOf(T(600))}`, 5000, 'カードで Delete')
          assert(!exists(T(600)) && exists(T(601)), 'カードのタスクを削除（他は残る）')
          assert((await dialogSeen(c)) === false, '削除の確認ダイアログ・未保存の確認は一度も出ない')
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ],
    [
      'インライン編集（5.9）: ダブルクリック・F2、Enter・blur・Esc・空・変更なし・保存失敗・IME・仮想化・詳細との競合・カード',
      async () => {
        const PE = U(4001)
        const ME = U(4101)
        await seedDatabase(editDir, {
          projects: [{ id: PE, name: '編集の案件', createdAt: at(BASE, 1) }],
          milestones: [{ id: ME, projectId: PE, name: 'M', createdAt: at(BASE, 2) }],
          tasks: [
            ...Array.from({ length: 300 }, (_, i) => ({ id: T(5000 + i), title: `編集 ${String(i).padStart(3, '0')}`, createdAt: at(BASE, 1000 + i) })),
            { id: T(6000), title: 'カードの編集', createdAt: at(BASE, 5000), projectId: PE, milestoneId: ME }
          ]
        })
        const row = (id) => readDb(editDir, 'SELECT title, updated_at FROM tasks WHERE id = ?', id)[0]
        const editor = `document.querySelector('[data-testid=inline-title-editor] input')`
        const top = T(5299) // 一番新しい（先頭に表示）
        const second = T(5298)
        await withApp({ label: 'inline-edit', userDataDir: editDir }, async (app) => {
          const c = app.cdp
          await waitInbox(c)
          // ダブルクリック → 入力欄（listbox の外）・既存の名前・フォーカス
          await doubleClick(c, titleOf(top))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, 'ダブルクリックで編集')
          const shape = await c.evaluate(`({ value: ${editor}.value, inListbox: !!${editor}.closest('[role=listbox]'), inOption: !!${editor}.closest('[role=option]') })`)
          assert(shape.value === '編集 299' && !shape.inListbox && !shape.inOption, '既存名を編集できる。listbox/option の中に textbox を置かない', shape)
          // Enter で保存（前後の空白を除く）。一覧へフォーカスが戻る
          await c.setInput('[data-testid=inline-title-editor] input', '  編集 299 改  ')
          const before = row(top)
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`!${editor}`, 3000, 'Enter で閉じる')
          assert(row(top).title === '編集 299 改' && row(top).updated_at !== before.updated_at, 'Enter で保存', row(top))
          assert(await c.evaluate(`document.activeElement === document.querySelector('[data-testid=task-list]')`), '一覧へフォーカスを戻す')
          // Enter の後の blur で二重に保存しない（直後にフォーカスを外しても1回だけ）
          await doubleClick(c, titleOf(top))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, '編集')
          await c.setInput('[data-testid=inline-title-editor] input', '編集 299 改2')
          await c.evaluate(`(() => { const i = ${editor}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); i.blur() })()`)
          await c.waitFor(`!${editor}`, 3000, 'Enter と blur')
          await sleep(300)
          assert(row(top).title === '編集 299 改2', '保存した', row(top))
          assert(!(await c.evaluate(`!!document.querySelector('[data-testid=inline-title-error]')`)), 'エラーなし')
          // 変更なし → updatedAt を変えない
          const unchanged = row(top)
          await doubleClick(c, titleOf(top))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, '編集')
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`!${editor}`, 3000, '変更なしで閉じる')
          assert(JSON.stringify(row(top)) === JSON.stringify(unchanged), '変更なしでは保存しない（updatedAt も変えない）')
          // Esc で取り消し
          await doubleClick(c, titleOf(top))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, '編集')
          await c.setInput('[data-testid=inline-title-editor] input', '取り消す')
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!${editor}`, 3000, 'Esc で閉じる')
          assert(row(top).title === '編集 299 改2', 'Esc では保存しない')
          // 空は保存せず、入力とエラーを残す
          await doubleClick(c, titleOf(top))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, '編集')
          await c.setInput('[data-testid=inline-title-editor] input', '   ')
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`document.querySelector('[data-testid=inline-title-error]')?.textContent.includes('タイトルを入力')`, 3000, '空のエラー')
          assert((await c.evaluate(`${editor}?.value`)) === '   ' && row(top).title === '編集 299 改2', '入力を残し、保存しない')
          await keyWith(c, 'Escape', 27)
          // IME変換中の Enter では保存しない（CDPの合成入力。実IMEではない）
          await doubleClick(c, titleOf(second))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, '編集')
          await c.setInput('[data-testid=inline-title-editor] input', '')
          await c.send('Input.imeSetComposition', { text: 'へんかん', selectionStart: 4, selectionEnd: 4 })
          await sleep(100)
          await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 })
          await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 })
          await sleep(300)
          assert((await c.evaluate(`!!${editor}`)) && row(second).title === '編集 298', '変換中の Enter では保存しない')
          await c.insertText('変換')
          await sleep(100)
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`!${editor}`, 3000, '確定後の Enter で保存')
          assert(row(second).title === '変換', '確定した文字を保存', row(second))
          // blur で保存（別の場所をクリック）
          await doubleClick(c, titleOf(second))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, '編集')
          await c.setInput('[data-testid=inline-title-editor] input', 'blurで保存')
          await c.click(`document.querySelector('[data-testid=view-search]')`)
          await c.waitFor(`!${editor}`, 3000, 'blur で閉じる')
          assert(row(second).title === 'blurで保存', 'blur で保存', row(second))
          // F2 でも開始できる（行の「…」メニューは削除だけになり、「名前を変更」は置かない）
          await c.focus('[data-testid=task-list]')
          await keyWith(c, 'Home', 36)
          await keyWith(c, 'F2', 113)
          await c.waitFor(`document.activeElement === ${editor}`, 3000, 'F2 で編集')
          await keyWith(c, 'Escape', 27)
          await c.evaluate(`${rowOf(second)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))`)
          await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')?.contains(document.activeElement)`, 3000, '行のメニュー')
          await sleep(150)
          const menuItems = await c.evaluate(`[...document.querySelectorAll('[data-testid=task-row-menu] [role=menuitem]')].map((e) => e.textContent)`)
          assert(JSON.stringify(menuItems) === JSON.stringify(['削除']), '行の「…」メニューに名前の変更は置かない', menuItems)
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=task-row-menu]') && document.activeElement === document.querySelector('[data-testid=task-list]')`, 3000, 'メニューを閉じて一覧へ戻る')
          // 仮想化: 編集中の行が表示範囲の外へ出ても、入力を失わない
          await doubleClick(c, titleOf(top))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, '編集')
          await c.setInput('[data-testid=inline-title-editor] input', 'スクロールしても残る')
          await c.evaluate(`document.querySelector('[data-testid=task-list-scroll]').scrollTop = 99999`)
          await sleep(300)
          const kept = await c.evaluate(`({ value: ${editor}?.value ?? null, rendered: document.querySelectorAll('[data-testid=task-list] [role=option]').length })`)
          assert(kept.value === 'スクロールしても残る' && kept.rendered < 120, '仮想化で表示範囲外になっても入力を残す', kept)
          await c.evaluate(`document.querySelector('[data-testid=task-list-scroll]').scrollTop = 0`)
          await sleep(200)
          await c.focus('[data-testid=inline-title-editor] input')
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`!${editor}`, 3000, '保存')
          assert(row(top).title === 'スクロールしても残る', 'スクロール後に保存')
          // 入力欄の上ではドラッグを始めない
          await doubleClick(c, titleOf(top))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, '編集')
          const from = await pointOf(c, editor)
          await mouseDown(c, from)
          await mouseMoveTo(c, from, { x: from.x + 60, y: from.y + 40 }, 6)
          assert(!(await c.evaluate(`!!document.querySelector('[data-testid=task-drag-preview]')`)), '入力中はドラッグを始めない')
          await mouseUp(c, { x: from.x + 60, y: from.y + 40 })
          await c.focus('[data-testid=inline-title-editor] input')
          await keyWith(c, 'Escape', 27)
          // 詳細パネルとの競合: インラインで保存した名前は、詳細の（未編集の）入力に反映する
          await c.click(rowOf(top))
          await c.focus('[data-testid=task-list]')
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, '詳細')
          await doubleClick(c, titleOf(top))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, '編集')
          await c.setInput('[data-testid=inline-title-editor] input', 'インラインの新しい名前')
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`document.querySelector('[data-testid=task-editor] input:not([type=hidden])')?.value === 'インラインの新しい名前'`, 3000, '詳細の入力も新しい名前（古い値で巻き戻さない）')
          assert(!(await c.evaluate(`document.querySelector('[data-testid=task-editor]').textContent.includes('未保存の変更があります')`)), '詳細は未保存扱いにしない')
          // 詳細で同じタスクを編集中（未保存）なら、インライン編集の前に既存の確認を出す（キャンセルで開始しない）
          await c.setInput('[data-testid=task-editor] input:not([type=hidden])', '詳細の未保存')
          await doubleClick(c, titleOf(top))
          await c.waitFor(`document.querySelector('[role=dialog]')?.innerText.includes('タスクのタイトルの変更を保存しますか')`, 3000, '既存の確認')
          await c.click(c.byText('[role=dialog] button', 'キャンセル'))
          await sleep(300)
          assert(!(await c.evaluate(`!!${editor}`)) && row(top).title === 'インラインの新しい名前', 'キャンセルではインライン編集を始めない')
          await c.click(c.byText('[data-testid=task-editor] button', '変更を取り消す'))
          // 保存失敗: 対象が既に削除されていた（APIで削除。一覧は再取得していない）→ 入力と理由を残す
          await doubleClick(c, titleOf(second))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, '編集')
          await api(c, `window.gtd.tasks.delete({ id: ${JSON.stringify(second)} })`)
          await c.setInput('[data-testid=inline-title-editor] input', '保存できない')
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`document.querySelector('[data-testid=inline-title-error]')?.textContent.includes('保存できませんでした')`, 5000, '保存失敗の理由')
          assert((await c.evaluate(`${editor}?.value`)) === '保存できない', '失敗時は入力を残す')
          await keyWith(c, 'Escape', 27)
          // 編集中の画面遷移は既存の確認を通す
          await doubleClick(c, titleOf(top))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, '編集')
          await c.setInput('[data-testid=inline-title-editor] input', '遷移前の未保存')
          await c.evaluate(`document.querySelector('nav button[aria-label="Project"]').click()`)
          await c.waitFor(`document.querySelector('[role=dialog]')?.innerText.includes('タスクのタイトルの変更を保存しますか')`, 3000, '遷移前の確認')
          await c.click(c.byText('[role=dialog] button', '保存'))
          await c.waitFor(`location.hash.startsWith('#/projects')`, 5000, '保存して遷移')
          assert(row(top).title === '遷移前の未保存', '確認で保存した')
          // カードでもダブルクリックで編集
          await c.evaluate(`location.hash = ${JSON.stringify(`#/projects/${PE}`)}`)
          await c.waitFor(`${rowOf(T(6000))}`, 5000, 'カード')
          await doubleClick(c, titleOf(T(6000)))
          await c.waitFor(`document.activeElement === ${editor}`, 3000, 'カードで編集')
          await c.setInput('[data-testid=inline-title-editor] input', 'カードで編集した')
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`!${editor}`, 3000, '保存')
          assert(row(T(6000)).title === 'カードで編集した', 'カードのタスク名を保存')
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ]
  ]
}
