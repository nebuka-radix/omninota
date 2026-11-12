// フェーズ6: 期限と Summary Review のUIシナリオ。run.mjs から呼ぶ。
// TaskRow から: 期限は行の2行目の期限表示（未設定なら期限設定アイコン）を押して開くメニュー。Summary Review の各行も TaskRow。
// 専用の一時userData・一時DBだけを使う。日付の判定は、タイムゾーン（TZ=Asia/Tokyo）とテスト用の時計
// （GTD_TEST_CLOCK_FILE。テストモードの Main だけが読む）で固定する。UTCの日付とローカルの日付が異なる時刻を使う。
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, clickWith, keyWith, MOD, requestQuit, sleep } from './lib.mjs'
import { readDb, rowOf, seedDatabase, U } from './scenarios-inbox-ops.mjs'

// UTC 2026-11-11 15:30 は、東京（UTC+9）では 2026-11-12 00:30
const START = '2026-11-11T15:30:00.000Z'
const TODAY = '2026-11-12'

export function dueSummaryScenarios({ withApp, root }) {
  const dueDir = join(root, 'userData-due')
  const summaryDir = join(root, 'userData-summary')
  const bulkDir = join(root, 'userData-summary-bulk')
  const clockFile = join(root, 'clock.json')
  const setClock = (at) => writeFileSync(clockFile, JSON.stringify({ at, setAt: Date.now() }))
  const env = { TZ: 'Asia/Tokyo', GTD_TEST_CLOCK_FILE: clockFile }
  const P = 'a6000000-0000-4000-8000-000000000001'
  const M = 'b6000000-0000-4000-8000-000000000002'
  const M2 = 'b6000000-0000-4000-8000-000000000003'
  const T = (n) => U(60000 + n)
  const BASE = '2026-11-01T00:00:00.000Z'
  const at = (s) => new Date(Date.parse(BASE) + s * 1000).toISOString()

  const api = (c, expression) =>
    c.evaluate(`(${expression}).then((r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data })`)
  const titleOf = (id) => `document.querySelector('[data-testid=task-list] [data-task-id="${id}"] [data-testid=task-title]')`
  // 行の操作ボタン（一覧の外側の重ね合わせ層）
  const controlOf = (id, testId) => `document.querySelector('[data-task-row-controls="${id}"] [data-testid=${testId}]')`
  const dueButton = (id) => `(${controlOf(id, 'task-due')} ?? ${controlOf(id, 'task-due-set')})`
  const dueChip = (c, id) => c.evaluate(`${controlOf(id, 'task-due')}?.dataset.due ?? null`)
  const dueText = (c, id) => c.evaluate(`${controlOf(id, 'task-due')}?.textContent ?? null`)
  const dueInDb = (dir, id) => readDb(dir, 'SELECT dueto, updated_at, title FROM tasks WHERE id = ?', id)[0]
  // 行の期限表示（未設定なら期限設定アイコン）→ 期限のメニュー
  const openDueMenu = async (c, id) => {
    await c.click(dueButton(id))
    await c.waitFor(`document.querySelector('[data-testid=task-due-menu] [role=menu]')?.contains(document.activeElement)`, 3000, '期限のメニュー')
    await sleep(150)
  }
  const dueIs = (id, value) => `${controlOf(id, 'task-due')}?.dataset.due === ${JSON.stringify(value)}`
  const waitInbox = async (c) => {
    await c.waitFor(`location.hash === '#/inbox' && document.querySelector('[data-testid=task-list] [role=option]')`, 10000, 'Inbox')
    await sleep(300)
  }

  return [
    [
      '期限（6・TaskRow）: 期限表示・設定アイコンから（Today・Tomorrow・日付指定・キャンセル・不正な日付・解除）、ローカル日付、複数選択中も1行だけ、表示、競合',
      async () => {
        setClock(START)
        await seedDatabase(dueDir, {
          projects: [{ id: P, name: '期限の案件', createdAt: at(1) }],
          milestones: [{ id: M, projectId: P, name: 'M', createdAt: at(2) }],
          tasks: [
            { id: T(1), title: 'A', createdAt: at(10) },
            { id: T(2), title: 'B', createdAt: at(11) },
            { id: T(3), title: 'C', createdAt: at(12) },
            { id: T(4), title: 'カードのタスク（長い名前で、狭い幅でも期限とメニューが重ならないことを確かめる）', createdAt: at(13), projectId: P, milestoneId: M }
          ]
        })
        await withApp({ label: 'due', userDataDir: dueDir, extraEnv: env }, async (app) => {
          const c = app.cdp
          await waitInbox(c)
          assert((await dueChip(c, T(1))) === null && (await c.evaluate(`!!${controlOf(T(1), 'task-due-set')}`)), '期限なしでは期限設定アイコンだけを表示')
          // 今日（UTC では 11/11、東京では 11/12）
          await openDueMenu(c, T(1))
          const menuItems = await c.evaluate(`[...document.querySelectorAll('[data-testid=task-due-menu] [role=menuitem]')].map((e) => e.textContent.trim())`)
          assert(JSON.stringify(menuItems) === JSON.stringify(['Today', 'Tomorrow', '日付指定…', '期限を解除']), '期限のメニューの項目', menuItems)
          assert(await c.evaluate(`document.querySelector('[data-testid=task-due-clear]').getAttribute('aria-disabled') === 'true'`), '期限がなければ「期限を解除」は無効')
          await c.click(`document.querySelector('[data-testid=task-due-today]')`)
          await c.waitFor(dueIs(T(1), TODAY), 5000, '今日を表示')
          assert((await dueText(c, T(1))) === 'Today', 'Today と表示', await dueText(c, T(1)))
          assert(dueInDb(dueDir, T(1)).dueto === TODAY, 'ローカルの暦日（UTCの日付ではない）で保存', dueInDb(dueDir, T(1)))
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=task-list]')`, 2000, '一覧へフォーカスを戻す')
          // 複数選択中でも、行の期限の操作はその行だけ（設定済みの期限表示を押して変更する）
          await c.click(rowOf(T(1)))
          await clickWith(c, rowOf(T(2)), MOD.meta)
          await openDueMenu(c, T(1))
          await c.click(`document.querySelector('[data-testid=task-due-tomorrow]')`)
          await c.waitFor(dueIs(T(1), '2026-11-13'), 5000, '明日')
          assert((await dueText(c, T(1))) === 'Tomorrow', 'Tomorrow と表示', await dueText(c, T(1)))
          assert(dueInDb(dueDir, T(2)).dueto === null, '選択中の他のタスクは変えない')
          assert((await c.evaluate(`document.querySelectorAll('[data-testid=task-list] [aria-selected=true]').length`)) === 2, '選択は変えない')
          // 日付指定: 不正な日付・キャンセルでは保存しない
          await openDueMenu(c, T(2))
          await c.click(`document.querySelector('[data-testid=task-due-pick]')`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=task-due-input]')`, 3000, '日付の入力欄にフォーカス')
          await c.setInput('[data-testid=task-due-input]', '2026-02-30')
          await c.click(`document.querySelector('[data-testid=task-due-confirm]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-due-dialog]')?.textContent.includes('日付が正しくありません')`, 3000, '不正な日付の理由')
          assert(dueInDb(dueDir, T(2)).dueto === null, '不正な日付は保存しない')
          await c.click(`document.querySelector('[data-testid=task-due-cancel]')`)
          await c.waitFor(`!document.querySelector('[data-testid=task-due-dialog]')`, 3000, 'キャンセル')
          assert(dueInDb(dueDir, T(2)).dueto === null, 'キャンセルでは保存しない')
          // 日付指定（過去・うるう日）をキーボードで確定（Enter）
          await openDueMenu(c, T(2))
          await c.click(`document.querySelector('[data-testid=task-due-pick]')`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=task-due-input]')`, 3000, '日付の入力欄')
          await c.setInput('[data-testid=task-due-input]', '2024-02-29')
          await c.focus('[data-testid=task-due-input]')
          await c.enter()
          await c.waitFor(`!document.querySelector('[data-testid=task-due-dialog]')`, 3000, 'Enter で確定')
          await c.waitFor(dueIs(T(2), '2024-02-29'), 5000, '過去の日付を表示')
          const overdue = await c.evaluate(`(() => { const e = ${controlOf(T(2), 'task-due')}; return { kind: e.dataset.dueKind, text: e.textContent, label: e.getAttribute('aria-label'), icon: !!e.querySelector('svg') } })()`)
          assert(overdue.kind === 'overdue' && overdue.text === '2024/2/29(木)' && overdue.label.includes('期限超過') && overdue.icon, '昨日以前は日付そのもの・期限超過（色だけでなくアイコンと読み上げ）', overdue)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=task-list]')`, 2000, '一覧へフォーカスを戻す')
          // 既存の期限を初期値にし、同じ期限の再設定では updatedAt を変えない
          const before = dueInDb(dueDir, T(2))
          await openDueMenu(c, T(2))
          await c.click(`document.querySelector('[data-testid=task-due-pick]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-due-input]')?.value === '2024-02-29'`, 3000, '既存の期限が初期値')
          await c.click(`document.querySelector('[data-testid=task-due-confirm]')`)
          await c.waitFor(`!document.querySelector('[data-testid=task-due-dialog]')`, 3000, '確定')
          await sleep(300)
          assert(JSON.stringify(dueInDb(dueDir, T(2))) === JSON.stringify(before), '同じ期限では updatedAt を変えない')
          // 解除
          await openDueMenu(c, T(2))
          await c.click(`document.querySelector('[data-testid=task-due-clear]')`)
          await c.waitFor(`!${controlOf(T(2), 'task-due')} && ${controlOf(T(2), 'task-due-set')}`, 5000, '解除すると期限設定アイコンに戻る')
          assert(dueInDb(dueDir, T(2)).dueto === null, '解除を保存')
          // メニューを開いたまま日付が変わっても、選んだ時点の日付で保存する
          await openDueMenu(c, T(3))
          setClock('2026-11-12T15:10:00.000Z') // 東京 11/13 00:10
          await c.click(`document.querySelector('[data-testid=task-due-today]')`)
          await c.waitFor(dueIs(T(3), '2026-11-13'), 5000, '日付が変わった後の今日')
          setClock(START)
          // タイトルの編集中（詳細の未保存の入力）に期限を変えても、入力を失わない
          await c.click(rowOf(T(1)))
          await c.focus('[data-testid=task-list]')
          await keyWith(c, 'Enter', 13)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, '詳細')
          await c.setInput('[data-testid=task-editor] input:not([type=hidden])', 'A（未保存）')
          await openDueMenu(c, T(1))
          await c.click(`document.querySelector('[data-testid=task-due-today]')`)
          await c.waitFor(dueIs(T(1), TODAY), 5000, '期限の変更')
          assert((await c.evaluate(`document.querySelector('[data-testid=task-editor] input:not([type=hidden])').value`)) === 'A（未保存）', '詳細の未保存のタイトルを失わない')
          assert(dueInDb(dueDir, T(1)).title === 'A', 'タイトルは保存していない')
          await c.click(c.byText('[data-testid=task-editor] button', '変更を取り消す'))
          // 削除済み（画面は再取得前）への期限の保存は失敗として表示し、対象を作り直さない
          await api(c, `window.gtd.tasks.delete({ id: ${JSON.stringify(T(3))} })`)
          await openDueMenu(c, T(3))
          await c.click(`document.querySelector('[data-testid=task-due-tomorrow]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-due-error]')?.textContent.includes('見つかりません')`, 5000, '保存失敗の理由')
          assert(readDb(dueDir, 'SELECT COUNT(*) AS n FROM tasks WHERE id = ?', T(3))[0].n === 0, '削除済みのタスクを作り直さない')
          assert((await dueChip(c, T(3))) === '2026-11-13', '失敗時は保存済みの値のまま表示（偽って変えない）')
          // プロジェクトのカード: 期限を設定し、最小のカード幅でも1行目（チェック・タスク名）と2行目（星・期限・紐付け・…）が重ならない
          await c.evaluate(`location.hash = ${JSON.stringify(`#/projects/${P}`)}`)
          await c.waitFor(`${rowOf(T(4))}`, 5000, 'カード')
          await openDueMenu(c, T(4))
          await c.click(`document.querySelector('[data-testid=task-due-tomorrow]')`)
          await c.waitFor(dueIs(T(4), '2026-11-13'), 5000, 'カードで期限')
          await c.focus('[data-testid=card-resize-handle]')
          await keyWith(c, 'Home', 36)
          await sleep(400)
          const rects = await c.evaluate(`(() => {
            const r = (e) => e.getBoundingClientRect()
            const controls = '[data-task-row-controls="${T(4)}"] '
            const q = (s) => r(document.querySelector(s))
            const star = q(controls + '[data-testid=task-favorite]'), due = q(controls + '[data-testid=task-due]'), assign = q(controls + '[data-testid=task-assign]'), menu = q(controls + '[data-testid=task-row-menu-button]')
            const title = q('[data-task-id="${T(4)}"] [data-testid=task-title]')
            const check = q('[data-task-id="${T(4)}"] input[type=checkbox]')
            const handle = q('[data-reorder-task-id="${T(4)}"]')
            const card = q('[data-testid=milestone-card]')
            const row = q('[data-task-id="${T(4)}"]')
            return { cardWidth: Math.round(card.width), handleRight: handle.right, checkLeft: check.left, checkRight: check.right, titleLeft: title.left, titleRight: title.right, titleBottom: title.bottom, rowRight: row.right,
              starLeft: star.left, starRight: star.right, dueLeft: due.left, dueRight: due.right, dueWidth: due.width, assignLeft: assign.left, assignRight: assign.right, menuLeft: menu.left, menuRight: menu.right, line2Top: Math.min(star.top, due.top, assign.top, menu.top) }
          })()`)
          const ok =
            rects.cardWidth === 144 &&
            rects.handleRight <= rects.checkLeft + 0.5 && rects.checkRight <= rects.titleLeft + 0.5 && rects.titleRight <= rects.rowRight + 0.5 &&
            rects.titleBottom <= rects.line2Top + 0.5 &&
            rects.starRight <= rects.dueLeft + 0.5 && rects.dueRight <= rects.assignLeft + 0.5 && rects.assignRight <= rects.menuLeft + 0.5 && rects.menuRight <= rects.rowRight + 0.5 &&
            rects.dueWidth > 8
          assert(ok, '最小のカード幅でも重ならない（長い名前は省略・期限も必要なら省略）', rects)
          // インライン編集は従来どおり（期限の表示を足しても壊さない）
          await c.evaluate(`(() => { const e = ${titleOf(T(4))}; e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })()`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=inline-title-editor] input')`, 3000, 'ダブルクリックで編集')
          await keyWith(c, 'Escape', 27)
          await c.focus('[data-testid=card-resize-handle]')
          await keyWith(c, 'End', 35)
          await sleep(300)
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ],
    [
      'Summary Review（6）: サイドバーの位置と遷移、3つの見出しと分類（今日・明日・明後日〜7日後）、除外、Inbox・同名、件数、トップバーの設定なし',
      async () => {
        setClock(START)
        const d = (offset) => {
          const date = new Date(Date.UTC(2026, 10, 12 + offset))
          return date.toISOString().slice(0, 10)
        }
        await seedDatabase(summaryDir, {
          projects: [{ id: P, name: '案件', createdAt: at(1) }],
          milestones: [
            { id: M, projectId: P, name: '設計', createdAt: at(2) },
            { id: M2, projectId: P, name: '消すM', createdAt: at(3) }
          ],
          tasks: [
            { id: T(10), title: '昨日', createdAt: at(10), dueto: d(-1) },
            { id: T(11), title: '今日のInbox', createdAt: at(12), dueto: d(0) },
            { id: T(12), title: '今日の案件', createdAt: at(11), dueto: d(0), projectId: P, milestoneId: M },
            { id: T(13), title: '明日', createdAt: at(13), dueto: d(1) },
            { id: T(14), title: '明後日', createdAt: at(14), dueto: d(2) },
            { id: T(15), title: '7日後', createdAt: at(15), dueto: d(7) },
            { id: T(16), title: '8日後', createdAt: at(16), dueto: d(8) },
            { id: T(17), title: '期限なし', createdAt: at(17) },
            { id: T(18), title: '完了済み', createdAt: at(18), dueto: d(0), doneOn: at(100) },
            { id: T(19), title: '非表示', createdAt: at(19), dueto: d(0), projectId: P, hiddenAt: at(100) },
            // 同名・同じ期限の別のタスク（作成日時 → ID の順。消さない）
            { id: T(21), title: '同名', createdAt: at(20), dueto: d(3) },
            { id: T(20), title: '同名', createdAt: at(20), dueto: d(3) },
            { id: T(22), title: '後で非表示になる', createdAt: at(22), dueto: d(1), projectId: P, milestoneId: M2 }
          ]
        })
        const sections = (c) =>
          c.evaluate(`(() => {
            const by = (s) => [...document.querySelectorAll('[data-testid=summary-review] section[data-section=' + s + '] [role=option]')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((e) => e.querySelector('[data-testid=task-title]').textContent)
            return { today: by('todayItems'), tomorrow: by('tomorrowItems'), week: by('thisWeekItems'), overdue: by('overdueItems'), empty: document.querySelectorAll('[data-testid=summary-empty]').length, day: document.querySelector('[data-testid=summary-review]')?.dataset.today }
          })()`)
        const count = (c) => c.evaluate(`document.querySelector('[data-testid=status-center]')?.textContent ?? null`)
        const openSummary = async (c) => {
          await c.click(`document.querySelector('nav button[aria-label="Summary Review"]')`)
          await c.waitFor(`location.hash === '#/summary' && document.querySelector('[data-testid=summary-review]')`, 5000, 'Summary Review')
          await sleep(300)
        }
        await withApp({ label: 'summary', userDataDir: summaryDir, extraEnv: env }, async (app) => {
          const c = app.cdp
          await c.waitFor(`location.hash === '#/inbox'`, 10000, '初期表示はInboxのまま')
          const nav = await c.evaluate(`[...document.querySelectorAll('nav[aria-label="ナビゲーション"] button[aria-label]')].map((b) => b.getAttribute('aria-label')).filter((l) => ['Summary Review', 'Inbox', 'Project', '設定'].includes(l))`)
          assert(JSON.stringify(nav) === JSON.stringify(['Summary Review', 'Inbox', 'Project', '設定']), 'Inbox の直上に Summary Review', nav)
          await openSummary(c)
          assert((await c.evaluate(`document.querySelector('nav button[aria-label="Summary Review"]').getAttribute('aria-current')`)) === 'page', '選択中の表示')
          const headings = await c.evaluate(`[...document.querySelectorAll('[data-testid=summary-heading]')].map((e) => e.textContent)`)
          assert(JSON.stringify(headings) === JSON.stringify(['Actions for Today', 'Actions for This Week', 'Actions for Tomorrow', 'Overdue Actions']), '4つの見出し（左上・右上・左下・右下の順）', headings)
          const visibleTitle = await c.evaluate(`[...document.querySelectorAll('main h1')].some((h) => h.getBoundingClientRect().height > 1)`)
          assert(!visibleTitle, '大きな画面タイトルを出さない')
          let s = await sections(c)
          assert(s.day === TODAY, 'ローカルの今日（UTCの日付ではない）で判定', s)
          assert(JSON.stringify(s.today) === JSON.stringify(['今日の案件', '今日のInbox']), 'Today（作成日時の順・Inboxも含む）', s)
          assert(JSON.stringify(s.tomorrow) === JSON.stringify(['明日', '後で非表示になる']), 'Tomorrow', s)
          assert(JSON.stringify(s.week) === JSON.stringify(['明後日', '同名', '同名', '7日後']), '明後日〜7日後（両端を含む）・同名も別に表示', s)
          assert(JSON.stringify(s.overdue) === JSON.stringify(['昨日']), 'Overdue は昨日以前だけ（今日は含めない）。8日後・期限なし・完了・非表示はどこにも出さない', s)
          const sameIds = await c.evaluate(`[...document.querySelectorAll('[data-testid=summary-review] [role=option]')].filter((e) => e.querySelector('[data-testid=task-title]').textContent === '同名').map((e) => e.dataset.taskId)`)
          assert(JSON.stringify(sameIds) === JSON.stringify([T(20), T(21)]), '同名・同時刻はIDの昇順で安定', sameIds)
          // 所属は紐付けアイコンのツールチップ・読み上げで示す（TaskRow の2行目は操作だけ）
          const context = await c.evaluate(`({ project: document.querySelector('[data-task-row-controls="${T(12)}"] [data-testid=task-assign]').title, inbox: document.querySelector('[data-task-row-controls="${T(11)}"] [data-testid=task-assign]').title })`)
          assert(context.project.includes('案件 / 設計') && context.inbox.includes('Inbox'), '所属（プロジェクト / マイルストン・Inbox）を紐付けアイコンで示す', context)
          assert((await count(c)) === '9 件', 'ステータスバーの中央に4区画の合計件数', await count(c))
          const top = await c.evaluate(`document.querySelector('[data-testid=top-bar-controls]').children.length`)
          assert(top === 0, 'トップバーに Inbox／Project の表示設定を出さない', top)

          // 他の画面での変更を反映: 完了・期限の変更・解除・非表示化
          await api(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(T(11))}, completed: true })`)
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
          await waitInbox(c)
          assert((await count(c))?.includes('件表示 / 全'), '他の画面へ移るとその画面の件数', await count(c))
          // Inbox の行の期限表示から期限を変更（明日 → セクションの移動）・解除
          await openDueMenu(c, T(14))
          await c.click(`document.querySelector('[data-testid=task-due-tomorrow]')`)
          await c.waitFor(dueIs(T(14), '2026-11-13'), 5000, '期限の変更')
          await openDueMenu(c, T(15))
          await c.click(`document.querySelector('[data-testid=task-due-clear]')`)
          await c.waitFor(`!${controlOf(T(15), 'task-due')}`, 5000, '期限の解除')
          await api(c, `window.gtd.milestones.delete({ id: ${JSON.stringify(M2)}, expectedTaskCount: 1 })`)
          await openSummary(c)
          s = await sections(c)
          assert(JSON.stringify(s.today) === JSON.stringify(['今日の案件']) && JSON.stringify(s.tomorrow) === JSON.stringify(['明日', '明後日']) && JSON.stringify(s.week) === JSON.stringify(['同名', '同名']) && JSON.stringify(s.overdue) === JSON.stringify(['昨日']), '完了・期限の変更・解除・非表示化を反映（画面へ戻ると取り直す）', s)
          assert((await count(c)) === '6 件', '件数も更新', await count(c))

          // 日付の変化: 再フォーカスで確かめる（東京 11/13 になる）
          setClock('2026-11-12T15:00:00.000Z') // 東京 11/13 00:00 ちょうど
          await c.evaluate(`window.dispatchEvent(new Event('focus'))`)
          await c.waitFor(`document.querySelector('[data-testid=summary-review]')?.dataset.today === '2026-11-13'`, 5000, '再フォーカスで新しい日付')
          s = await sections(c)
          assert(
            JSON.stringify(s.today) === JSON.stringify(['明日', '明後日']) && JSON.stringify(s.tomorrow) === JSON.stringify([]) && s.empty === 1 && JSON.stringify(s.overdue) === JSON.stringify(['昨日', '今日の案件']),
            '0時ちょうどで切り替わり（前日の Today は Overdue へ）、0件の見出しは「該当なし」',
            s
          )
          // スリープ復帰相当（表示の再開）
          setClock('2026-11-14T15:00:00.000Z') // 東京 11/15
          await c.evaluate(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })()`)
          await c.waitFor(`document.querySelector('[data-testid=summary-review]')?.dataset.today === '2026-11-15'`, 5000, '表示の再開で新しい日付')
          s = await sections(c)
          // 11/15: 今日は 11/15、This Week は 11/17〜11/22（期限 11/20 の「8日後」が入る）。昨日以前（11/11〜11/13）は Overdue（期限 → 作成日時の順）
          assert(
            JSON.stringify(s.today) === JSON.stringify(['同名', '同名']) && JSON.stringify(s.week) === JSON.stringify(['8日後']) && s.empty === 1 &&
              JSON.stringify(s.overdue) === JSON.stringify(['昨日', '今日の案件', '明日', '明後日']) && (await count(c)) === '7 件',
            '期間が新しい日付で移る（昨日以前は Overdue、新たに7日以内になったものを出す）',
            { s, count: await count(c) }
          )

          // 未保存の編集がある時の画面遷移は既存の確認を通る
          setClock(START)
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
          await waitInbox(c)
          await c.evaluate(`(() => { const e = ${titleOf(T(13))}; e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })()`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=inline-title-editor] input')`, 3000, 'インライン編集')
          await c.setInput('[data-testid=inline-title-editor] input', '未保存の名前')
          await c.evaluate(`document.querySelector('nav button[aria-label="Summary Review"]').click()`)
          await c.waitFor(`document.querySelector('[role=dialog]')?.innerText.includes('タスクのタイトルの変更を保存しますか')`, 3000, '遷移前の確認')
          await c.click(c.byText('[role=dialog] button', 'キャンセル'))
          await sleep(300)
          assert((await c.evaluate('location.hash')) === '#/inbox', 'キャンセルなら移動しない')
          // 確認ダイアログへフォーカスが移った時の blur で、入力は既存の規則どおり保存されている（入力を失わない）
          if (await c.evaluate(`!!document.querySelector('[data-testid=inline-title-editor] input')`)) {
            await c.focus('[data-testid=inline-title-editor] input')
            await keyWith(c, 'Escape', 27)
          }
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ],
    [
      'Summary Review（6）: 大量データ（This Week 1,500件）でも描画は一部・件数は全件、片方のセクションが0件でも見出しを残す',
      async () => {
        setClock(START)
        await seedDatabase(bulkDir, {
          tasks: Array.from({ length: 1500 }, (_, i) => ({ id: U(300000 + i), title: `週 ${i}`, createdAt: at(1000 + i), dueto: '2026-11-15' }))
        })
        await withApp({ label: 'summary-bulk', userDataDir: bulkDir, extraEnv: env }, async (app) => {
          const c = app.cdp
          await c.click(`document.querySelector('nav button[aria-label="Summary Review"]')`)
          await c.waitFor(`document.querySelector('[data-testid=summary-review] [role=option]')`, 10000, 'Summary Review')
          await sleep(300)
          const info = await c.evaluate(`({ rendered: document.querySelectorAll('[data-testid=summary-review] [role=option]').length, empty: document.querySelectorAll('[data-testid=summary-empty]').length, count: document.querySelector('[data-testid=status-center]').textContent })`)
          assert(info.rendered > 0 && info.rendered < 100 && info.empty === 3 && info.count === '1500 件', '仮想化（描画は一部）・件数は全件・0件の見出しは「該当なし」', info)
          await c.evaluate(`document.querySelector('section[data-section=thisWeekItems] [data-testid=task-list-scroll]').scrollTop = 999999`)
          await sleep(300)
          const last = await c.evaluate(`[...document.querySelectorAll('[data-testid=summary-review] [role=option]')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).at(-1)?.dataset.taskId`)
          assert(last === U(301499), '末尾までスクロールできる（作成日時の順）', last)
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ]
  ]
}
