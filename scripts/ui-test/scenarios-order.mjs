// フェーズ5.9: プロジェクト内のタスクの初期順・手動順、カード（マイルストン）の順序、column／row のレイアウト、大量データのUIシナリオ。
// run.mjs から呼ぶ。すべて専用の一時userData（root配下）だけを使う。事前データは一時DBへ直接用意する（アプリの起動前）。
import { join } from 'node:path'
import { assert, clickWith, keyWith, MOD, mouseDown, mouseMoveTo, mouseUp, pointOf, requestQuit, sleep } from './lib.mjs'
import { readDb, rowOf, seedDatabase, U } from './scenarios-inbox-ops.mjs'

const at = (base, seconds) => new Date(Date.parse(base) + seconds * 1000).toISOString()

export function orderScenarios({ withApp, root }) {
  const dir = join(root, 'userData-order')
  const bulkDir = join(root, 'userData-order-bulk')
  const BASE = '2026-11-02T00:00:00.000Z'
  const P = U(7001)
  // 同名のマイルストン（M1 と M3）は IDの先頭が異なる（画面の区別は作成日時・IDの先頭8文字）
  const M1 = 'f1000000-0000-4000-8000-000000007101'
  const M2 = 'f2000000-0000-4000-8000-000000007102'
  const M3 = 'f3000000-0000-4000-8000-000000007103'
  // M1: A〜D（未完了）と E（完了）。作成日時の古い順に A, B, C, D, E
  const [A, B, C, D, E] = [U(7201), U(7202), U(7203), U(7204), U(7205)]
  const name = { [A]: 'A', [B]: 'B', [C]: 'C', [D]: 'D', [E]: 'E' }

  const api = (c, expression) =>
    c.evaluate(`(${expression}).then((r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data })`)
  const openProject = async (c) => {
    await c.evaluate(`location.hash = ${JSON.stringify(`#/projects/${P}`)}`)
    await c.waitFor(`document.querySelector('[data-testid=milestone-board] [data-testid=milestone-card]')`, 8000, 'カード')
    await sleep(300)
  }
  const cardTasks = (c, milestoneId) =>
    c.evaluate(`[...document.querySelectorAll('[data-card-list="group:${milestoneId}"] [role=option]')].map((e) => e.dataset.taskId)`)
  const cardOrder = (c) => c.evaluate(`[...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => e.dataset.milestoneId)`)
  const dbTaskOrder = (milestoneId) =>
    readDb(dir, 'SELECT id, position FROM tasks WHERE milestone_id = ? AND hidden_at IS NULL ORDER BY position IS NULL, position, created_at, id', milestoneId)
  const setStatus = async (c, value) => {
    await c.click(`document.querySelector('[data-testid=view-status] button[value=${value}]')`)
    await sleep(250)
  }
  const chooseSort = async (c, key) => {
    await c.click(`document.querySelector('[data-testid=view-sort-select] [role=combobox]')`)
    await c.waitFor(`document.querySelector('[data-sort-key=${key}]')`, 3000, '並べ替えの選択肢')
    await sleep(150)
    await c.click(`document.querySelector('[data-sort-key=${key}]')`)
    await c.waitFor(`!document.querySelector('[data-sort-key=${key}]')`, 3000, '選択肢を閉じる')
    await sleep(200)
  }
  const sortValue = (c) => c.evaluate(`document.querySelector('[data-testid=view-sort-select] input').value`)
  const handle = (taskId) => `document.querySelector('[data-reorder-task-id="${taskId}"]')`
  const cardHandle = (milestoneId) => `document.querySelector('[data-card-move="${milestoneId}"]')`
  // 行のハンドルを掴んで、指定した行の上端（before）／下端へ運ぶ
  const dragHandle = async (c, taskId, targetTaskId, { ry = 0.15, release = true } = {}) => {
    const from = await pointOf(c, handle(taskId))
    await mouseDown(c, from)
    const to = await pointOf(c, rowOf(targetTaskId), { ry, scroll: false })
    await mouseMoveTo(c, from, { x: from.x, y: to.y }, 8)
    await sleep(100)
    if (release) await mouseUp(c, { x: from.x, y: to.y })
    return { x: from.x, y: to.y }
  }

  return [
    [
      'Project（5.9）: タスクの初期順（作成日時の古い順）・手動順の並べ替え（ハンドル・Alt+↑↓・Esc）・絞り込み中の制限・手動順への切り替え',
      async () => {
        await seedDatabase(dir, {
          projects: [{ id: P, name: '順序の案件', createdAt: at(BASE, 1) }],
          milestones: [
            { id: M1, projectId: P, name: 'M1', createdAt: at(BASE, 10) },
            { id: M2, projectId: P, name: 'M2', createdAt: at(BASE, 11) },
            { id: M3, projectId: P, name: 'M1', createdAt: at(BASE, 12) }
          ],
          tasks: [
            // 作成日時の順と、IDの順・タイトルの順をずらしておく
            { id: C, title: 'C', createdAt: at(BASE, 103), projectId: P, milestoneId: M1 },
            { id: A, title: 'A', createdAt: at(BASE, 101), projectId: P, milestoneId: M1 },
            { id: E, title: 'E', createdAt: at(BASE, 105), projectId: P, milestoneId: M1, doneOn: at(BASE, 200) },
            { id: B, title: 'B', createdAt: at(BASE, 102), projectId: P, milestoneId: M1 },
            { id: D, title: 'D', createdAt: at(BASE, 104), projectId: P, milestoneId: M1 },
            { id: U(7301), title: 'M2-1', createdAt: at(BASE, 110), projectId: P, milestoneId: M2 },
            { id: U(7302), title: 'M2-2', createdAt: at(BASE, 111), projectId: P, milestoneId: M2 },
            // 同時刻（IDの昇順で安定）
            { id: U(7304), title: 'M2-same-b', createdAt: at(BASE, 112), projectId: P, milestoneId: M2 },
            { id: U(7303), title: 'M2-same-a', createdAt: at(BASE, 112), projectId: P, milestoneId: M2 },
            { id: U(7401), title: 'Inbox から', createdAt: at(BASE, 120) }
          ]
        })
        const created = readDb(dir, 'SELECT id, created_at, done_on, updated_at FROM tasks ORDER BY id')
        await withApp({ label: 'task-order', userDataDir: dir }, async (app) => {
          const c = app.cdp
          await openProject(c)
          assert((await sortValue(c)) === 'manual', '既定の並べ替えは手動順', await sortValue(c))
          // 状態「未完了」（既定）では E は出ない。初期順は作成日時の古い順
          assert((await cardTasks(c, M1)).map((id) => name[id]).join('') === 'ABCD', '初期順は作成日時の古い順', await cardTasks(c, M1))
          assert((await cardTasks(c, M2)).join() === [U(7301), U(7302), U(7303), U(7304)].join(), '同時刻はIDの昇順で安定', await cardTasks(c, M2))
          // 絞り込み中（状態が「すべて」以外）は並べ替えできない（理由を示す）
          assert(await c.evaluate(`${handle(A)}.hasAttribute('data-reorder-disabled')`), '状態が「未完了」ではハンドルを無効にする')
          await c.click(`document.querySelector('[data-card-list="group:${M1}"] [data-task-id="${A}"] [data-testid=task-title]')`)
          await c.focus(`[data-card-list="group:${M1}"]`)
          await keyWith(c, 'ArrowDown', 40, MOD.alt)
          await c.waitFor(`document.querySelector('[data-testid=reorder-notice]')?.textContent.includes('「すべて」')`, 3000, '無効の理由を表示')
          assert(dbTaskOrder(M1).every((t) => t.position === null), '絞り込み中は保存しない')
          await setStatus(c, 'all')
          assert((await cardTasks(c, M1)).map((id) => name[id]).join('') === 'ABCDE', '「すべて」では完了済みも含めて作成日時の古い順')
          // 検索中も無効
          await c.setInput('input[aria-label="タイトルで絞り込み"]', 'A')
          await sleep(200)
          assert(await c.evaluate(`${handle(A)}.hasAttribute('data-reorder-disabled')`), '検索中はハンドルを無効にする')
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '')
          await sleep(200)

          // ハンドルのドラッグ: D を先頭へ
          await dragHandle(c, D, A, { ry: 0.1 })
          await c.waitFor(`[...document.querySelectorAll('[data-card-list="group:${M1}"] [role=option]')].map((e) => e.dataset.taskId).join() === ${JSON.stringify([D, A, B, C, E].join())}`, 5000, 'D を先頭へ')
          assert(dbTaskOrder(M1).map((t) => `${name[t.id]}${t.position}`).join() === 'D0,A1,B2,C3,E4', '手動順を保存（全件に順位）', dbTaskOrder(M1))
          // Esc で取り消し
          await dragHandle(c, B, D, { ry: 0.1, release: false })
          assert(await c.evaluate(`!!document.querySelector('[data-testid=reorder-indicator]')`), '挿入位置を表示')
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=reorder-indicator]')`, 2000, 'Esc で取り消し')
          await mouseUp(c, await pointOf(c, rowOf(D), { scroll: false }))
          await sleep(300)
          assert(dbTaskOrder(M1).map((t) => name[t.id]).join('') === 'DABCE', 'Esc では保存しない')
          // キーボード: Alt+↓ で A を1つ下へ
          await c.click(`document.querySelector('[data-card-list="group:${M1}"] [data-task-id="${A}"] [data-testid=task-title]')`)
          await c.focus(`[data-card-list="group:${M1}"]`)
          await keyWith(c, 'ArrowDown', 40, MOD.alt)
          await c.waitFor(`[...document.querySelectorAll('[data-card-list="group:${M1}"] [role=option]')].map((e) => e.dataset.taskId).join() === ${JSON.stringify([D, B, A, C, E].join())}`, 5000, 'Alt+↓')
          assert(dbTaskOrder(M1).map((t) => name[t.id]).join('') === 'DBACE', 'キーボードの並べ替えを保存')
          // 並べ替えで日時（作成・完了・更新）は変えない
          const after = readDb(dir, 'SELECT id, created_at, done_on, updated_at FROM tasks ORDER BY id')
          assert(JSON.stringify(after) === JSON.stringify(created), '並べ替えでは createdAt・doneOn・updatedAt を変えない')

          // 手動順以外（作成日時が古い順）でハンドルを使う → 手動順へ切り替わることを示し、保存後に切り替える
          await chooseSort(c, 'created-asc')
          assert((await cardTasks(c, M1)).map((id) => name[id]).join('') === 'ABCDE', '作成日時が古い順')
          assert((await c.evaluate(`${handle(E)}.title`)).includes('手動順'), 'ハンドルに手動順へ切り替わることを示す')
          await dragHandle(c, E, A, { ry: 0.1 })
          await c.waitFor(`document.querySelector('[data-testid=reorder-notice]')?.textContent.includes('手動順')`, 3000, '手動順へ切り替えたことを示す')
          await c.waitFor(`document.querySelector('[data-testid=view-sort-select] input')?.value === 'manual'`, 3000, '並べ替えが手動順になる')
          assert((await cardTasks(c, M1)).map((id) => name[id]).join('') === 'EABCD', '表示していた順序で手動順を保存', await cardTasks(c, M1))

          // 新規作成は手動順の末尾、手動順のない M2 は作成日時の順（position null）
          await c.click(`document.querySelector('[data-testid="new-task-${M1}-button"]')`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid="new-task-${M1}"] input')`, 3000, 'NEW TASK')
          await c.insertText('新規F')
          await c.enter()
          await c.waitFor(`[...document.querySelectorAll('[data-card-list="group:${M1}"] [role=option]')].length === 6`, 5000, '追加')
          await keyWith(c, 'Escape', 27)
          const m1 = dbTaskOrder(M1)
          assert(m1.length === 6 && m1[5].position === 5, '新規タスクは手動順の末尾', m1)
          assert((await cardTasks(c, M1)).length === 6 && (await cardTasks(c, M1))[5] === m1[5].id, '画面でも末尾')
          // Inboxから移したタスクも末尾
          await api(c, `window.gtd.tasks.assignFromInbox({ ids: [${JSON.stringify(U(7401))}], projectId: ${JSON.stringify(P)}, milestoneId: ${JSON.stringify(M1)} })`)
          assert(dbTaskOrder(M1).at(-1).id === U(7401) && dbTaskOrder(M1).at(-1).position === 6, '移動したタスクも末尾', dbTaskOrder(M1))
          assert(dbTaskOrder(M2).every((t) => t.position === null), '手動順のないマイルストンは変えない')
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
        // 再起動後も順序を復元する（並べ替えの既定は手動順）
        await withApp({ label: 'task-order-restart', userDataDir: dir }, async (app) => {
          const c = app.cdp
          await openProject(c)
          await setStatus(c, 'all')
          const ids = await cardTasks(c, M1)
          assert(ids.join() === dbTaskOrder(M1).map((t) => t.id).join() && name[ids[0]] === 'E', '再起動後も手動順を復元', ids)
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ],
    [
      'Project（5.9）: カードの順序（ドラッグ・キーボード・Esc）・NEW MILESTONE は末尾・column／row の切り替えと設定の復元・カード幅の保持',
      async () => {
        await withApp({ label: 'card-order', userDataDir: dir }, async (app) => {
          const c = app.cdp
          // カード幅を変えておく（row の間も保持し、column へ戻した時に使う）
          const settings = await api(c, 'window.gtd.workspace.get()')
          await openProject(c)
          await c.focus('[data-testid=card-resize-handle]')
          await keyWith(c, 'ArrowLeft', 37, MOD.shift)
          await sleep(400)
          const width = (await api(c, 'window.gtd.workspace.get()')).milestoneCardWidth
          assert(width === settings.milestoneCardWidth - 64, 'カード幅を変更', width)
          // 初期順（作成日時の古い順）。同名の M1 は ID で区別する
          assert((await cardOrder(c)).join() === [M1, M2, M3].join(), 'カードの初期順は作成日時の古い順', await cardOrder(c))
          // ドラッグ（column は左右）: M1 を末尾へ
          const from = await pointOf(c, cardHandle(M1))
          await mouseDown(c, from)
          const lastCard = await pointOf(c, `document.querySelector('[data-milestone-id="${M3}"]')`, { rx: 0.9, scroll: false })
          await mouseMoveTo(c, from, { x: lastCard.x, y: from.y }, 10)
          await sleep(100)
          assert(await c.evaluate(`!!document.querySelector('[data-insert-after]')`), '挿入位置を表示')
          await mouseUp(c, { x: lastCard.x, y: from.y })
          await c.waitFor(`[...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => e.dataset.milestoneId).join() === ${JSON.stringify([M2, M3, M1].join())}`, 5000, 'カードの移動')
          const dbOrder = () => readDb(dir, 'SELECT id, position FROM milestones WHERE project_id = ? ORDER BY position IS NULL, position, created_at, id', P)
          assert(dbOrder().map((m) => m.id).join() === [M2, M3, M1].join() && dbOrder().every((m) => m.position !== null), 'カードの順序を保存', dbOrder())
          // Esc で取り消し
          const from2 = await pointOf(c, cardHandle(M2))
          await mouseDown(c, from2)
          await mouseMoveTo(c, from2, { x: from2.x + 400, y: from2.y }, 6)
          await keyWith(c, 'Escape', 27)
          await mouseUp(c, { x: from2.x + 400, y: from2.y })
          await sleep(300)
          assert(dbOrder().map((m) => m.id).join() === [M2, M3, M1].join(), 'Esc では保存しない')
          // キーボード: ハンドルで ← （同名の M1 と M3 を ID で区別）
          await c.focus(`[data-card-move="${M1}"]`)
          await keyWith(c, 'ArrowLeft', 37)
          await c.waitFor(`[...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => e.dataset.milestoneId).join() === ${JSON.stringify([M2, M1, M3].join())}`, 5000, '← で前へ')
          await keyWith(c, 'Home', 36)
          await c.waitFor(`[...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => e.dataset.milestoneId).join() === ${JSON.stringify([M1, M2, M3].join())}`, 5000, 'Home で先頭へ')
          // NEW MILESTONE は常に末尾。新しいマイルストンは末尾に追加
          await c.click(`document.querySelector('[data-testid=new-milestone-button]')`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=new-milestone] input')`, 3000, 'NEW MILESTONE')
          await c.insertText('M4')
          await c.enter()
          await c.waitFor(`document.querySelectorAll('[data-testid=milestone-card]').length === 4`, 5000, 'マイルストンの追加')
          const last = await c.evaluate(`(() => { const board = document.querySelector('[data-testid=milestone-board]'); const children = [...board.children]; return { lastIsNew: !!children.at(-1).querySelector('[data-testid=new-milestone], [data-testid=new-milestone-button]'), lastCard: [...board.querySelectorAll('[data-testid=milestone-card]')].at(-1).querySelector('[data-testid=group-label]').textContent } })()`)
          assert(last.lastIsNew && last.lastCard === 'M4', '新しいマイルストンはカードの末尾、NEW MILESTONE はその後', last)
          assert(dbOrder().at(-1).position === 3, '新しいマイルストンは手動順の末尾', dbOrder())

          // column → row（検索・状態・手動順・カード順を維持。row では幅のハンドルなし）
          await c.setInput('input[aria-label="タイトルで絞り込み"]', 'M2')
          await setStatus(c, 'all')
          const beforeCards = await cardOrder(c)
          await c.click(`document.querySelector('[data-testid=view-layout] button[value=row]')`)
          await c.waitFor(`document.querySelector('[data-testid=milestone-board]')?.dataset.layout === 'row'`, 3000, 'row')
          const shape = await c.evaluate(`(() => {
            const board = document.querySelector('[data-testid=milestone-board]').getBoundingClientRect()
            const cards = [...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => e.getBoundingClientRect())
            return { vertical: cards.every((r, i) => i === 0 || r.top > cards[i - 1].top), sameLeft: cards.every((r) => Math.abs(r.left - cards[0].left) < 1), wide: cards.every((r) => r.width > board.width - 40), handles: document.querySelectorAll('[data-testid=card-resize-handle]').length, search: document.querySelector('input[aria-label="タイトルで絞り込み"]').value, status: document.querySelector('[data-testid=view-status] button[aria-pressed=true]')?.value }
          })()`)
          assert(shape.vertical && shape.sameLeft && shape.wide && shape.handles === 0, 'row: 上から下へ、メイン領域の横幅、幅のハンドルなし', shape)
          assert(shape.search === 'M2' && shape.status === 'all' && (await cardOrder(c)).join() === beforeCards.join() && (await sortValue(c)) === 'manual', '切り替えても検索・状態・並べ替え・カード順を維持', shape)
          await sleep(500)
          const saved = await api(c, 'window.gtd.workspace.get()')
          assert(saved.milestoneLayout === 'row' && saved.milestoneCardWidth === width, 'レイアウトを保存し、カード幅は保持する', saved)
          // row ではカードを上下にドラッグして並べ替え
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '')
          await sleep(200)
          const top = await pointOf(c, cardHandle(M1))
          await mouseDown(c, top)
          const second = await pointOf(c, `document.querySelector('[data-milestone-id="${M2}"]')`, { ry: 0.9, scroll: false })
          await mouseMoveTo(c, top, { x: top.x, y: second.y }, 8)
          await mouseUp(c, { x: top.x, y: second.y })
          await c.waitFor(`[...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => e.dataset.milestoneId).slice(0, 2).join() === ${JSON.stringify([M2, M1].join())}`, 5000, 'row で上下に移動')
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
        // 再起動後: row を復元。column へ戻すとカード幅も復元
        await withApp({ label: 'card-layout-restart', userDataDir: dir }, async (app) => {
          const c = app.cdp
          await openProject(c)
          assert((await c.evaluate(`document.querySelector('[data-testid=milestone-board]').dataset.layout`)) === 'row', '再起動後も row を復元')
          assert((await cardOrder(c)).slice(0, 2).join() === [M2, M1].join(), '再起動後もカードの順序を復元', await cardOrder(c))
          const expected = (await api(c, 'window.gtd.workspace.get()')).milestoneCardWidth
          await c.click(`document.querySelector('[data-testid=view-layout] button[value=column]')`)
          await c.waitFor(`document.querySelector('[data-testid=milestone-board]')?.dataset.layout === 'column'`, 3000, 'column')
          const cardWidth = await c.evaluate(`Math.round(document.querySelector('[data-testid=milestone-card]').getBoundingClientRect().width)`)
          assert(cardWidth === expected && (await c.evaluate(`document.querySelectorAll('[data-testid=card-resize-handle]').length`)) > 0, 'column に戻すと保存済みのカード幅', { cardWidth, expected })
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ],
    [
      '大量データ（5.9）: Inbox 2,000件の範囲選択・一括ドラッグ（自動スクロール）・カード 600件の並べ替え（自動スクロール）・row の仮想化',
      async () => {
        const BP = U(8001)
        const BM = U(8101)
        const BM2 = U(8102)
        await seedDatabase(bulkDir, {
          projects: [{ id: BP, name: '大量', createdAt: at(BASE, 1) }],
          milestones: [
            { id: BM, projectId: BP, name: '大量M', createdAt: at(BASE, 2) },
            { id: BM2, projectId: BP, name: '受け入れ', createdAt: at(BASE, 3) }
          ],
          tasks: [
            ...Array.from({ length: 2000 }, (_, i) => ({ id: U(100000 + i), title: `大量 ${i}`, createdAt: at(BASE, 1000 + i) })),
            ...Array.from({ length: 600 }, (_, i) => ({ id: U(200000 + i), title: `カード ${i}`, createdAt: at(BASE, 5000 + i), projectId: BP, milestoneId: BM }))
          ]
        })
        await withApp({ label: 'bulk-ops', userDataDir: bulkDir }, async (app) => {
          const c = app.cdp
          await c.waitFor(`location.hash === '#/inbox' && document.querySelector('[data-testid=task-list] [role=option]')`, 15000, 'Inbox')
          await sleep(300)
          // 先頭をクリック → 末尾までスクロール → Shift+クリック（描画外の行も表示順で範囲に入る）
          const first = await c.evaluate(`document.querySelector('[data-testid=task-list] [role=option]').dataset.taskId`)
          await c.click(rowOf(first))
          await c.evaluate(`document.querySelector('[data-testid=task-list-scroll]').scrollTop = 99999999`)
          await sleep(300)
          const lastId = await c.evaluate(`[...document.querySelectorAll('[data-testid=task-list] [role=option]')].at(-1).dataset.taskId`)
          await clickWith(c, rowOf(lastId), MOD.shift)
          await c.waitFor(`document.querySelector('[data-testid=selection-count]')?.textContent === '2000 件選択中'`, 5000, '2000件の範囲選択')
          const rendered = await c.evaluate(`document.querySelectorAll('[data-testid=task-list] [role=option]').length`)
          assert(rendered < 200, '仮想化を維持（描画は一部）', rendered)
          // 選択した行をドラッグし、紐付け先の一覧へ（一覧の端の自動スクロールの後に）ドロップ
          const from = await pointOf(c, rowOf(lastId), { rx: 0.3 })
          await mouseDown(c, from)
          const scroller = await pointOf(c, `document.querySelector('[data-testid=task-list-scroll]')`, { ry: 0.02, scroll: false })
          await mouseMoveTo(c, from, { x: from.x, y: scroller.y }, 6)
          const scrolledBefore = await c.evaluate(`document.querySelector('[data-testid=task-list-scroll]').scrollTop`)
          await sleep(600)
          const scrolledAfter = await c.evaluate(`document.querySelector('[data-testid=task-list-scroll]').scrollTop`)
          assert(scrolledAfter < scrolledBefore, 'ドラッグ中に一覧の上端で自動スクロール', { scrolledBefore, scrolledAfter })
          const target = await pointOf(c, `document.querySelector('[data-drop-milestone-id="${BM2}"]')`, { scroll: false })
          await mouseMoveTo(c, { x: from.x, y: scroller.y }, target, 8)
          const p = await c.evaluate(`document.querySelector('[data-testid=task-drag-preview]')?.dataset.dragCount`)
          assert(p === '2000', '2000件をまとめてドラッグ', p)
          await mouseUp(c, target)
          await c.waitFor(`!document.querySelector('[data-testid=task-list] [role=option]')`, 20000, '2000件を一括で紐付け')
          const moved = readDb(bulkDir, 'SELECT COUNT(*) AS n FROM tasks WHERE milestone_id = ?', BM2)[0].n
          assert(moved === 2000, '1回の一括APIで2000件を保存', moved)

          // カード 600件: row の仮想化と、ハンドルのドラッグで一覧の下端まで自動スクロールして移動
          await c.evaluate(`location.hash = ${JSON.stringify(`#/projects/${BP}`)}`)
          await c.waitFor(`document.querySelector('[data-card-list="group:${BM}"] [role=option]')`, 8000, 'カード')
          await c.click(`document.querySelector('[data-testid=view-status] button[value=all]')`)
          await sleep(300)
          await c.click(`document.querySelector('[data-testid=view-layout] button[value=row]')`)
          await c.waitFor(`document.querySelector('[data-testid=milestone-board]')?.dataset.layout === 'row'`, 3000, 'row')
          const rowRendered = await c.evaluate(`document.querySelectorAll('[data-card-list="group:${BM}"] [role=option]').length`)
          assert(rowRendered > 0 && rowRendered < 60, 'row でも仮想化を維持', rowRendered)
          const firstCard = U(200000)
          const start = await pointOf(c, `document.querySelector('[data-reorder-task-id="${firstCard}"]')`)
          await mouseDown(c, start)
          const listBox = await c.evaluate(`(() => { const r = document.querySelector('[data-card-list="group:${BM}"]').closest('[data-testid=task-list-scroll]').getBoundingClientRect(); return { bottom: r.bottom } })()`)
          await mouseMoveTo(c, start, { x: start.x, y: listBox.bottom - 4 }, 8)
          await sleep(2500)
          await mouseUp(c, { x: start.x, y: listBox.bottom - 4 })
          await sleep(800)
          const order = readDb(bulkDir, 'SELECT id, position FROM tasks WHERE milestone_id = ? ORDER BY position', BM)
          const index = order.findIndex((t) => t.id === firstCard)
          // row のカードは8行分の高さ。8行目より後ろへ移ったことは、一覧の自動スクロールがあった証拠（移動量はフレームの速さで変わる）
          assert(order.every((t) => t.position !== null) && index > 8, '自動スクロールして表示範囲の外へ移動（600件の順位を保存）', { index })
          await c.click(`document.querySelector('[data-testid=view-layout] button[value=column]')`)
          await sleep(300)
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ]
  ]
}
