// Summary Review の4区画（2列×2行）と右サイドバーのプロジェクトのフィルターのUIシナリオ。run.mjs から呼ぶ。
// 専用の一時userData・一時DBだけを使う。日付は TZ=Asia/Tokyo とテスト用の時計（GTD_TEST_CLOCK_FILE）で固定する。
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, requestQuit, sleep } from './lib.mjs'
import { readDb, seedDatabase, U } from './scenarios-inbox-ops.mjs'

// UTC 2026-11-11 15:30 は、東京では 2026-11-12 00:30
const START = '2026-11-11T15:30:00.000Z'

export function summaryLayoutScenarios({ withApp, root }) {
  const clockFile = join(root, 'clock-summary-layout.json')
  const setClock = (at) => writeFileSync(clockFile, JSON.stringify({ at, setAt: Date.now() }))
  const env = { TZ: 'Asia/Tokyo', GTD_TEST_CLOCK_FILE: clockFile }
  const BASE = '2026-11-01T00:00:00.000Z'
  const at = (s) => new Date(Date.parse(BASE) + s * 1000).toISOString()
  const T = (n) => U(80000 + n)
  const PA = 'a8000000-0000-4000-8000-000000000001'
  const PB = 'a8000002-0000-4000-8000-000000000002'
  const PB2 = 'a8000003-0000-4000-8000-000000000003'
  const PDONE = 'a8000000-0000-4000-8000-000000000004'
  const MA = 'b8000000-0000-4000-8000-000000000001'
  const MB = 'b8000000-0000-4000-8000-000000000002'
  const MB2 = 'b8000000-0000-4000-8000-000000000003'
  const MD = 'b8000000-0000-4000-8000-000000000004'
  const d = (offset) => new Date(Date.UTC(2026, 10, 12 + offset)).toISOString().slice(0, 10)

  const api = (c, expression) =>
    c.evaluate(`(${expression}).then((r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data })`)
  const sections = (c) =>
    c.evaluate(`(() => {
      const by = (s) => [...document.querySelectorAll('section[data-section=' + s + '] [role=option]')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((e) => e.dataset.taskId)
      const n = (s) => Number(document.querySelector('section[data-section=' + s + '] [data-testid=summary-heading]').dataset.count)
      return { today: by('todayItems'), tomorrow: by('tomorrowItems'), week: by('thisWeekItems'), overdue: by('overdueItems'), counts: [n('todayItems'), n('tomorrowItems'), n('thisWeekItems'), n('overdueItems')], count: document.querySelector('[data-testid=status-center]')?.textContent }
    })()`)
  const openSummary = async (c) => {
    await c.click(`document.querySelector('nav button[aria-label="Summary Review"]')`)
    await c.waitFor(`location.hash === '#/summary' && document.querySelector('[data-testid=summary-review]') && document.querySelector('[data-testid=summary-project-filter]')`, 5000, 'Summary Review と右サイドバーのフィルター')
    await sleep(400)
  }
  const filterItems = (c) =>
    c.evaluate(`[...document.querySelectorAll('[data-testid=summary-project-filter-item]')].map((e) => ({ id: e.dataset.projectId, label: e.textContent, checked: e.querySelector('input[type=checkbox]').checked, done: !!e.querySelector('[data-testid=summary-project-done]') }))`)
  const toggle = async (c, projectId) => {
    await c.click(`document.querySelector('[data-testid=summary-project-filter-item][data-project-id="${projectId}"] input[type=checkbox]')`)
    await sleep(300)
  }

  return [
    [
      'Summary Review（4区画）: 2列×2行の配置（左上 Today・右上 This Week・左下 Tomorrow・右下 Overdue）・同じ幅と高さ・灰色の外枠と中央の罫線（二重線なし）・区画ごとのスクロール・行のはみ出しなし、右サイドバーのプロジェクトのフィルター（初期 ON・OFF で全区画から外す・Inbox は残す・データは変えない・同名の区別・完了済みの表示・新規は ON・削除は除外・セッション中は保持・再起動で ON）と件数',
      async () => {
        const dir = join(root, 'userData-summary-layout')
        setClock(START)
        await seedDatabase(dir, {
          projects: [
            { id: PA, name: '案件A', createdAt: at(1) },
            { id: PB, name: '同名', createdAt: at(2) },
            { id: PB2, name: '同名', createdAt: at(3) },
            { id: PDONE, name: '完了済みの案件', createdAt: at(4), doneOn: at(5) }
          ],
          milestones: [
            { id: MA, projectId: PA, name: 'M', createdAt: at(6) },
            { id: MB, projectId: PB, name: 'M', createdAt: at(7) },
            { id: MB2, projectId: PB2, name: 'M', createdAt: at(8) },
            { id: MD, projectId: PDONE, name: 'M', createdAt: at(9) }
          ],
          tasks: [
            // Today は区画の高さを超える件数（区画の中だけでスクロールする）
            ...Array.from({ length: 40 }, (_, i) => ({ id: T(i), title: `今日 ${i}`, createdAt: at(100 + i), dueto: d(0), projectId: PA, milestoneId: MA })),
            { id: T(100), title: 'Inboxの今日', createdAt: at(50), dueto: d(0) },
            { id: T(101), title: '明日（同名1）', createdAt: at(51), dueto: d(1), projectId: PB, milestoneId: MB },
            { id: T(102), title: '明日（同名2）', createdAt: at(52), dueto: d(1), projectId: PB2, milestoneId: MB2 },
            { id: T(103), title: '7日後（A）', createdAt: at(53), dueto: d(7), projectId: PA, milestoneId: MA },
            { id: T(104), title: '明後日（Inbox）', createdAt: at(54), dueto: d(2) },
            { id: T(105), title: '昨日（A）', createdAt: at(55), dueto: d(-1), projectId: PA, milestoneId: MA },
            { id: T(106), title: 'ずっと前（Inbox）', createdAt: at(56), dueto: '2020-01-01' },
            { id: T(107), title: '昨日（完了済みの案件）', createdAt: at(57), dueto: d(-1), projectId: PDONE, milestoneId: MD, doneOn: at(5) },
            { id: T(108), title: '完了済みプロジェクトの未完了', createdAt: at(58), dueto: d(-2), projectId: PDONE, milestoneId: MD },
            { id: T(109), title: '非表示', createdAt: at(59), dueto: d(-1), projectId: PA, hiddenAt: at(60) },
            { id: T(110), title: '8日後', createdAt: at(60), dueto: d(8) }
          ]
        })
        const snapshot = () => JSON.stringify(readDb(dir, 'SELECT * FROM tasks ORDER BY id')) + JSON.stringify(readDb(dir, 'SELECT * FROM projects ORDER BY id'))
        await withApp({ label: 'summary-layout', userDataDir: dir, extraEnv: env }, async (app) => {
          const c = app.cdp
          await c.waitFor(`location.hash === '#/inbox'`, 10000, 'Inbox')
          await openSummary(c)

          // 配置・寸法・罫線
          const layout = await c.evaluate(`(() => {
            const r = (e) => e.getBoundingClientRect()
            const grid = document.querySelector('[data-testid=summary-review]')
            const main = r(document.querySelector('main'))
            const s = (k) => document.querySelector('section[data-section=' + k + ']')
            const box = (k) => { const e = s(k); const b = r(e); const cs = getComputedStyle(e); return { left: b.left, top: b.top, width: b.width, height: b.height, right: b.right, bottom: b.bottom, br: cs.borderRightWidth + ' ' + cs.borderRightStyle, bb: cs.borderBottomWidth + ' ' + cs.borderBottomStyle, bt: cs.borderTopStyle, bl: cs.borderLeftStyle, heading: e.querySelector('[data-testid=summary-heading]').textContent } }
            const gs = getComputedStyle(grid)
            return { today: box('todayItems'), week: box('thisWeekItems'), tomorrow: box('tomorrowItems'), overdue: box('overdueItems'), border: gs.borderTopWidth + ' ' + gs.borderTopStyle + ' ' + gs.borderTopColor, gridHeight: r(grid).height, mainHeight: main.height }
          })()`)
          const { today, week, tomorrow, overdue } = layout
          assert(
            today.heading === 'Actions for Today' && week.heading === 'Actions for This Week' && tomorrow.heading === 'Actions for Tomorrow' && overdue.heading === 'Overdue Actions',
            '4区画の見出し',
            layout
          )
          assert(
            Math.abs(today.top - week.top) < 1 && Math.abs(tomorrow.top - overdue.top) < 1 && today.top < tomorrow.top &&
              Math.abs(today.left - tomorrow.left) < 1 && Math.abs(week.left - overdue.left) < 1 && today.left < week.left,
            '左上 Today・右上 This Week・左下 Tomorrow・右下 Overdue',
            layout
          )
          const sizes = [today, week, tomorrow, overdue]
          assert(Math.max(...sizes.map((x) => x.width)) - Math.min(...sizes.map((x) => x.width)) <= 2 && Math.max(...sizes.map((x) => x.height)) - Math.min(...sizes.map((x) => x.height)) <= 2, '2列は同じ幅・2行は同じ高さ（件数で押し出さない）', sizes)
          assert(layout.border === '1px solid rgb(90, 90, 90)' && layout.gridHeight > layout.mainHeight * 0.6, '灰色の外枠・メインパネルの領域いっぱい', layout)
          assert(
            today.br === '1px solid' && today.bb === '1px solid' && week.br.endsWith('none') && week.bb === '1px solid' && tomorrow.br === '1px solid' && tomorrow.bb.endsWith('none') && overdue.br.endsWith('none') && overdue.bb.endsWith('none') &&
              sizes.every((x) => x.bt === 'none' && x.bl === 'none'),
            '中央の縦横の罫線は1本（左の列の右・上の行の下だけ。外枠と重ねない）',
            sizes
          )

          // 分類
          let s = await sections(c)
          assert(s.counts[0] === 41 && s.today[0] === T(100), 'Today（Inbox のタスクも含む・作成日時の順）', s)
          assert(JSON.stringify(s.tomorrow) === JSON.stringify([T(101), T(102)]), 'Tomorrow（同名のプロジェクトも別）', s)
          assert(JSON.stringify(s.week) === JSON.stringify([T(104), T(103)]), 'This Week（明後日〜7日後・8日後は出さない）', s)
          assert(JSON.stringify(s.overdue) === JSON.stringify([T(106), T(108), T(105)]), 'Overdue（昨日以前すべて・期限 → 作成日時の順。完了済み・非表示は出さない。今日は含めない）', s)
          // 件数: 今日41（40+Inbox）・明日2・今週2・期限超過3
          assert(s.count === '48 件', 'ステータスバーの件数は4区画の合計（描画した行数ではない）', s.count)

          // 区画ごとのスクロール（Today だけがスクロールし、他の区画は動かない）・行は区画からはみ出さない
          const scroll = await c.evaluate(`(() => {
            const sc = document.querySelector('section[data-section=todayItems] [data-testid=task-list-scroll]')
            const before = document.querySelector('section[data-section=tomorrowItems]').getBoundingClientRect().top
            const canScroll = sc.scrollHeight > sc.clientHeight
            sc.scrollTop = 99999
            return { canScroll, scrolled: sc.scrollTop > 0, rendered: document.querySelectorAll('section[data-section=todayItems] [role=option]').length, before }
          })()`)
          await sleep(300)
          const after = await c.evaluate(`({ top: document.querySelector('section[data-section=tomorrowItems]').getBoundingClientRect().top, pageScroll: document.querySelector('main').scrollTop, last: [...document.querySelectorAll('section[data-section=todayItems] [role=option]')].some((e) => e.dataset.taskId === ${JSON.stringify(T(39))}) })`)
          assert(scroll.canScroll && scroll.scrolled && scroll.rendered < 41 && Math.abs(after.top - scroll.before) < 1 && after.last, '区画の中だけでスクロール（仮想化。他の区画は動かない）', { scroll, after })
          const overflow = await c.evaluate(`[...document.querySelectorAll('[data-testid=summary-review] section')].every((sec) => { const b = sec.getBoundingClientRect(); return [...sec.querySelectorAll('[role=option]')].every((o) => { const r = o.getBoundingClientRect(); return r.left >= b.left - 0.5 && r.right <= b.right + 0.5 }) && [...document.querySelectorAll('[data-task-row-controls]')].filter((x) => sec.contains(x)).every((x) => x.getBoundingClientRect().right <= b.right + 0.5) })`)
          assert(overflow, '行・操作は区画の中に収まる')

          // フィルター: 初期はすべて ON。完了済みも対象（補助表示）。同名は区別
          let items = await filterItems(c)
          assert(items.length === 4 && items.every((i) => i.checked), '初期はすべて ON（完了済みも含む）', items)
          const same = items.filter((i) => i.id === PB || i.id === PB2)
          assert(same.length === 2 && same[0].label !== same[1].label && same.every((i) => i.label.includes('ID')), '同名のプロジェクトを区別して表示', same)
          assert(items.find((i) => i.id === PDONE)?.done === true && items.filter((i) => i.done).length === 1, '完了済みは補助表示', items)
          const nav = await c.evaluate(`!!document.querySelector('[data-testid=project-list] [data-project-id="${PDONE}"]')`)
          assert(!nav, '左サイドバーには完了済みを出さない（従来どおり）')

          // OFF: 案件A のタスクを全区画から外す（Inbox のタスクは残す）。データは変えない
          const dbBefore = snapshot()
          await toggle(c, PA)
          s = await sections(c)
          assert(JSON.stringify(s.today) === JSON.stringify([T(100)]) && JSON.stringify(s.week) === JSON.stringify([T(104)]) && JSON.stringify(s.overdue) === JSON.stringify([T(106), T(108)]) && s.tomorrow.length === 2, 'OFF のプロジェクトのタスクを全区画から外し、Inbox は残す', s)
          assert(s.count === '6 件', 'フィルター後の件数', s.count)
          // 同名の片方だけ OFF
          await toggle(c, PB2)
          s = await sections(c)
          assert(JSON.stringify(s.tomorrow) === JSON.stringify([T(101)]) && s.count === '5 件', '同名でも ID で区別して外す', s)
          // 完了済みのプロジェクトを OFF → 0件の区画も見出しと「該当なし」を残す
          await toggle(c, PB)
          await toggle(c, PDONE)
          s = await sections(c)
          const empty = await c.evaluate(`[...document.querySelectorAll('[data-testid=summary-empty]')].map((e) => e.closest('section').dataset.section)`)
          assert(s.tomorrow.length === 0 && JSON.stringify(empty) === JSON.stringify(['tomorrowItems']) && s.count === '3 件', '0件の区画は見出しと「該当なし」', { s, empty })
          assert(snapshot() === dbBefore, 'フィルターはタスク・プロジェクトのデータを変えない')

          // 他の画面へ移ると、その画面の右サイドバー・件数。戻ると状態を保持
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
          await c.waitFor(`location.hash === '#/inbox' && document.querySelector('[data-testid=inbox-panel-tabs]') && !document.querySelector('[data-testid=summary-project-filter]')`, 5000, 'Inbox の右サイドバー')
          assert((await c.evaluate(`document.querySelector('[data-testid=status-center]')?.textContent`)).includes('件表示 / 全'), 'Inbox の件数')
          await openSummary(c)
          items = await filterItems(c)
          assert(items.filter((i) => !i.checked).map((i) => i.id).sort().join() === [PA, PB, PB2, PDONE].sort().join(), 'セッション中は選択を保持', items)
          // ON に戻す
          await toggle(c, PA)
          s = await sections(c)
          assert(s.counts[0] === 41 && s.overdue.includes(T(105)) && s.week.includes(T(103)) && s.count === '45 件', 'ON に戻すと再表示（件数も戻る）', s)
          // 新しいプロジェクトは ON、削除したプロジェクトは一覧から外す
          // （API で直接作成・削除するため、画面を移って一覧を取り直してから確かめる）
          const created = await api(c, `window.gtd.projects.create({ name: '新しい案件' })`)
          await api(c, `window.gtd.projects.delete({ id: ${JSON.stringify(PB2)}, expectedMilestoneCount: 1, expectedTaskCount: 1 })`)
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
          await c.waitFor(`location.hash === '#/inbox'`, 5000, 'Inbox')
          await openSummary(c)
          items = await filterItems(c)
          assert(!items.some((i) => i.id === PB2) && items.some((i) => i.id === created.id && i.checked), '新しいプロジェクトは ON、削除したプロジェクトは出さない', items)
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
        // 再起動するとすべて ON（保存しない）
        await withApp({ label: 'summary-layout-restart', userDataDir: dir, extraEnv: env }, async (app) => {
          const c = app.cdp
          await c.waitFor(`location.hash.length > 0`, 10000, '起動')
          await openSummary(c)
          const items = await filterItems(c)
          assert(items.length > 0 && items.every((i) => i.checked), '再起動するとすべて ON', items)
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ]
  ]
}
