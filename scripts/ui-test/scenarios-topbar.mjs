// フェーズ5.8: トップバー（高さ・画面ごとの表示設定）・ステータスバー（中央の件数）・サイドバー（区分の廃止・最小幅）・
// Inbox の追加先説明の削除・マイルストンカードの最小幅のUIシナリオ。
// run.mjs から呼ぶ。専用の一時userData（root配下）だけを使う。準備はPreloadの用途別APIと、起動前の一時DBへの直接書き込みで行う。
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { goToProject, assert, clickRowShowDetail, keyWith, MOD, createDatabaseAt, firstMilestoneId, openDatabaseReadOnly, requestQuit, sleep } from './lib.mjs'

// 変更前後の値（報告・検証用）
const TOP_BAR_HEIGHT = 40
const SIDEBAR_MIN = 108
const CARD_MIN = 144
const MIN_WINDOW_WIDTH = 752

export function topBarScenarios({ withApp, root }) {
  const dir = join(root, 'userData-topbar')
  const bulkDir = join(root, 'userData-topbar-bulk')
  const ids = {}

  const api = (c, expression) =>
    c.evaluate(`(${expression}).then((r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data })`)
  const workspace = (c) => api(c, 'window.gtd.workspace.get()')
  const reload = async (c) => {
    await c.evaluate('location.reload()')
    await c.waitFor(`document.querySelector('nav button[aria-label="Inbox"]')`, 10000, '再読み込み')
    await sleep(500)
  }
  const openProject = async (c, projectId) => {
    await goToProject(c, projectId)
    await c.waitFor(`location.hash === ${JSON.stringify(`#/projects/${projectId}`)}`, 5000, 'プロジェクトを開く')
    await c.waitFor(`document.querySelector('[data-testid=milestone-board]')`, 5000, 'カード列')
    await sleep(200)
  }
  const openInbox = async (c) => {
    await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
    await c.waitFor(`location.hash === '#/inbox' && document.querySelector('[data-testid=task-list]')`, 5000, 'Inbox')
    await sleep(200)
  }
  const countText = (c) => c.evaluate(`document.querySelector('[data-testid=status-center]')?.textContent ?? null`)
  const waitCount = (c, text, label) =>
    c.waitFor(`document.querySelector('[data-testid=status-center]')?.textContent === ${JSON.stringify(text)}`, 5000, `${label}: ${text}`)
  // トップバー・表示設定・ステータスバーの状態
  const shell = (c) =>
    c.evaluate(`(() => {
      const top = document.querySelector('[data-testid=top-bar]')
      const tr = top.getBoundingClientRect()
      const slot = document.querySelector('[data-testid=top-bar-controls]')
      const main = document.querySelector('main')
      const status = document.querySelector('[data-testid=status-bar]')
      const search = document.querySelector('input[aria-label="タイトルで絞り込み"]')
      const filter = document.querySelector('[aria-label="表示するタスク"]')
      const sort = document.querySelector('[data-testid=view-sort]')
      const center = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2 }
      const searchBox = search?.closest('.MuiInputBase-root')
      return {
        topHeight: Math.round(tr.height * 100) / 100,
        mainTop: Math.round(main.getBoundingClientRect().top - tr.bottom),
        slotChildren: slot.children.length,
        searchInTop: !!search && top.contains(search),
        filterInTop: !!filter && top.contains(filter),
        sortInTop: !!sort && top.contains(sort),
        inMain: {
          search: !!main.querySelector('input[aria-label="タイトルで絞り込み"]'),
          filter: !!main.querySelector('[aria-label="表示するタスク"]'),
          sort: !!main.querySelector('[data-testid=view-sort], [role=group][aria-label="並べ替え"]'),
          count: !!main.querySelector('[data-testid=task-count]') || /件表示/.test(main.innerText)
        },
        filterPressed: filter ? [...filter.querySelectorAll('button')].find((b) => b.getAttribute('aria-pressed') === 'true')?.value : null,
        searchValue: search?.value ?? null,
        centers: searchBox ? { top: center(top), search: center(searchBox), filter: center(filter) } : null,
        count: document.querySelector('[data-testid=status-center]').textContent,
        countInStatus: !!status.querySelector('[data-testid=task-count]')
      }
    })()`)
  // 横方向の重なり・はみ出し（トップバー・ステータスバー・サイドバー）
  const overlap = (c) =>
    c.evaluate(`(() => {
      const r = (e) => e.getBoundingClientRect()
      const top = document.querySelector('[data-testid=top-bar]')
      const slot = document.querySelector('[data-testid=top-bar-controls]')
      const toggle = top.querySelector('button[aria-controls=detail-panel]')
      const controls = [...slot.querySelectorAll('input, button, [role=group]')].map(r)
      const status = document.querySelector('[data-testid=status-bar]')
      const left = document.querySelector('[data-testid=status-left]')
      const app = document.querySelector('[data-testid=status-app]')
      const count = document.querySelector('[data-testid=task-count]')
      const cols = getComputedStyle(status).gridTemplateColumns.split(' ').map(parseFloat)
      const leftText = [...left.children].reduce((m, e) => Math.max(m, r(e).right), r(left).left)
      return {
        topScroll: top.scrollWidth - top.clientWidth,
        controlsRight: Math.max(...controls.map((x) => x.right)),
        controlsLeft: Math.min(...controls.map((x) => x.left)),
        slotLeft: r(slot).left,
        slotRight: r(slot).right,
        toggleLeft: r(toggle).left,
        toggleVisible: r(toggle).width > 0 && r(toggle).right <= window.innerWidth,
        searchWidth: r(slot.querySelector('input').closest('.MuiInputBase-root')).width,
        statusCols: cols,
        countCenter: count ? r(count).left + r(count).width / 2 : null,
        statusCenter: r(status).left + r(status).width / 2,
        countLeft: count ? r(count).left : null,
        countRight: count ? r(count).right : null,
        leftRight: Math.min(r(left).right, leftText),
        appLeft: r(app).left,
        appText: app.textContent,
        bodyScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth
      }
    })()`)
  const setViewport = (c, width, height = 760) =>
    c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const clearViewport = (c) => c.send('Emulation.clearDeviceMetricsOverride')
  // サイドバーの幅・はみ出し
  const sidebar = (c) =>
    c.evaluate(`(() => {
      const nav = document.querySelector('[data-testid=navigation]')
      const nr = nav.getBoundingClientRect()
      const main = document.querySelector('main').getBoundingClientRect()
      const inside = (e) => { if (!e) return false; const x = e.getBoundingClientRect(); return x.width > 0 && x.left >= nr.left - 0.5 && x.right <= nr.right + 0.5 }
      const items = [...nav.querySelectorAll('[data-testid=project-list] [data-project-id]')]
      const names = items.map((e) => { const t = e.querySelector('.MuiListItemText-primary'); return { id: e.dataset.projectId, clipped: t.scrollWidth > t.clientWidth, ellipsis: getComputedStyle(t).textOverflow, inside: inside(t) } })
      return {
        width: Math.round(nr.width),
        mainLeft: Math.round(main.left),
        navRight: Math.round(nr.right),
        navScroll: [...nav.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'auto'),
        badge: inside(document.querySelector('[data-testid=nav-inbox-badge]')),
        chevron: inside(nav.querySelector('button[aria-controls=navigation-projects]')),
        newProject: inside(nav.querySelector('[data-testid=new-project]')),
        settings: inside(nav.querySelector('button[aria-label="設定"]')),
        separator: (() => { const s = document.querySelector('[role=separator][aria-label^="ナビゲーションの幅"]').getBoundingClientRect(); return s.width > 0 })(),
        names
      }
    })()`)
  const dragSidebarTo = async (c, x) => {
    const start = await c.evaluate(`(() => { const s = document.querySelector('[role=separator][aria-label^="ナビゲーションの幅"]').getBoundingClientRect(); return { x: s.left + s.width / 2, y: s.top + 200 } })()`)
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y })
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 8; i++) {
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + ((x - start.x) * i) / 8, y: start.y, button: 'left', buttons: 1 })
      await sleep(30)
    }
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: start.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(400)
  }
  // カードの中身の収まり（最小幅のカード）
  const cardFit = (c) =>
    c.evaluate(`(() => {
      const card = document.querySelector('[data-testid=milestone-card]')
      const cr = card.getBoundingClientRect()
      const inside = (e) => { if (!e) return false; const x = e.getBoundingClientRect(); return x.width > 0 && x.left >= cr.left - 0.5 && x.right <= cr.right + 0.5 }
      const options = [...card.querySelectorAll('[role=option]')]
      const rows = options.map((o) => o.getBoundingClientRect()).sort((a, b) => a.top - b.top)
      const titles = options.map((o) => o.querySelector('span.MuiTypography-noWrap')).filter(Boolean)
      const cards = [...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => e.getBoundingClientRect())
      return {
        width: Math.round(cr.width),
        rename: inside(card.querySelector('[data-rename-milestone]')),
        menu: inside(card.querySelector('[data-milestone-menu]')),
        newTask: inside(card.querySelector('[data-testid$=-button][data-testid^=new-task-]')),
        handle: !!card.querySelector('[data-testid=card-resize-handle]'),
        label: (() => { const l = card.querySelector('[data-testid=group-label]'); return { clipped: l.scrollWidth > l.clientWidth, inside: inside(l) } })(),
        titlesInside: titles.every(inside),
        anyClipped: titles.some((t) => t.scrollWidth > t.clientWidth),
        rowsOverlap: rows.some((r, i) => i > 0 && r.top < rows[i - 1].bottom - 0.5),
        rowHeights: [...new Set(rows.map((r) => Math.round(r.height)))],
        cardsOverlap: cards.some((r, i) => i > 0 && r.left < cards[i - 1].right - 0.5)
      }
    })()`)

  return [
    [
      'トップバー・ステータスバー: 高さ32→40px・表示設定はトップバーに移動（重複なし）、画面ごとの切り替え（Inbox・Project・設定・未保存のNEW PROJECT）、件数はステータスバー中央、入力の再マウント・フォーカス喪失なし、Inboxの追加先説明なし',
      () =>
        withApp({ label: 'topbar', userDataDir: dir }, async (app) => {
          const c = app.cdp
          // Inbox: 未完了2・完了1。プロジェクトP: マイルストン2つ（未完了3・完了1）、空のプロジェクトE
          for (const title of ['報告 A', '連絡 B', '報告 C']) await api(c, `window.gtd.tasks.create({ title: ${JSON.stringify(title)} })`)
          const inboxTasks = await api(c, 'window.gtd.tasks.list()')
          await api(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(inboxTasks.find((t) => t.title === '報告 C').id)}, completed: true })`)
          ids.p = (await api(c, `window.gtd.projects.create({ name: '件数の確認' })`)).id
          ids.m1 = await firstMilestoneId(c, ids.p)
          ids.m2 = (await api(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(ids.p)}, name: 'M2' })`)).id
          for (const [title, m] of [['p-報告1', ids.m1], ['p-連絡2', ids.m1], ['p-報告3', ids.m2], ['p-完了4', ids.m2]]) {
            await api(c, `window.gtd.tasks.create({ title: ${JSON.stringify(title)}, projectId: ${JSON.stringify(ids.p)}, milestoneId: ${JSON.stringify(m)} })`)
          }
          const done = (await api(c, 'window.gtd.tasks.list()')).find((t) => t.title === 'p-完了4')
          await api(c, `window.gtd.tasks.setCompleted({ id: ${JSON.stringify(done.id)}, completed: true })`)
          ids.e = (await api(c, `window.gtd.projects.create({ name: '空の案件' })`)).id
          await reload(c)

          // Inbox
          await openInbox(c)
          let s = await shell(c)
          assert(s.topHeight === TOP_BAR_HEIGHT && s.mainTop === 0, `トップバーの高さは${TOP_BAR_HEIGHT}px、メイン領域はその直下から`, s)
          const heights = await c.evaluate(`(() => { const t = document.querySelector('[data-testid=top-bar]').getBoundingClientRect(); const m = document.querySelector('main').getBoundingClientRect(); const st = document.querySelector('[data-testid=status-bar]').getBoundingClientRect(); return { sum: Math.round(t.height + m.height + st.height), inner: window.innerHeight, statusBottom: Math.round(st.bottom) } })()`)
          assert(heights.sum === heights.inner && heights.statusBottom === heights.inner, 'トップバー・メイン領域・ステータスバーの高さがウィンドウの高さと一致（メイン領域の高さを整合）', heights)
          assert(s.searchInTop && s.filterInTop && !s.sortInTop, 'Inbox: キーワード・状態がトップバーにある（並べ替えは一覧の列見出しのまま）', s)
          assert(!s.inMain.search && !s.inMain.filter && !s.inMain.sort && !s.inMain.count, 'メインパネルに表示設定・件数を重複して残さない', s.inMain)
          assert(Math.abs(s.centers.search - s.centers.top) <= 1 && Math.abs(s.centers.filter - s.centers.top) <= 1, '入力欄・選択欄はトップバーの縦方向の中央', s.centers)
          assert(s.count === '2 件表示 / 全 3 件' && s.countInStatus, 'ステータスバー中央の件数（未完了2 / 全3）', s.count)
          const headers = await c.evaluate(`[...document.querySelectorAll('main [aria-label^="タイトルで並べ替え"], main [aria-label^="作成日時で並べ替え"]')].length`)
          assert(headers === 2, 'Inboxの列見出しの並べ替えは一覧に残る', headers)
          // Inboxの追加先説明はない（追加欄・アクセシブル名は維持）
          const add = await c.evaluate(`(() => { const i = document.querySelector('main input[aria-label="タスクのタイトル"]'); return { input: !!i, describedby: i?.getAttribute('aria-describedby') ?? null, text: document.querySelector('main').innerText.includes('追加先'), placeholder: i?.placeholder, target: !!document.querySelector('[data-testid=task-add-target]') } })()`)
          assert(add.input && add.describedby === null && !add.text && !add.target && !add.placeholder.includes('追加先'), 'Inboxの「追加先: Inbox（…）」を表示しない（入力欄の名前は維持・参照を残さない）', add)
          const firstOffset = await c.evaluate(`(() => { const t = document.querySelector('main [data-testid=page-title]'); const box = t.parentElement; const first = [...box.children].find((e) => e !== t); return Math.round(first.getBoundingClientRect().top - box.getBoundingClientRect().top - parseFloat(getComputedStyle(box).paddingTop)) })()`)
          assert(Math.abs(firstOffset) <= 1, '追加欄がパネルの上端から始まる（説明行の余白を残さない）', firstOffset)

          // キーワード入力: 1文字ずつ入力しても同じ入力欄のまま（再マウント・フォーカス喪失なし）、件数が追従
          await c.evaluate(`(window.__search = document.querySelector('input[aria-label="タイトルで絞り込み"]')) !== null`)
          await c.click(`window.__search`)
          for (const ch of ['報', '告']) {
            await c.insertText(ch)
            await sleep(80)
          }
          await waitCount(c, '1 件表示 / 全 3 件', '検索')
          let same = await c.evaluate(`({ same: document.querySelector('input[aria-label="タイトルで絞り込み"]') === window.__search, focused: document.activeElement === window.__search, value: window.__search.value })`)
          assert(same.same && same.focused && same.value === '報告', '入力中も同じ入力欄・フォーカスを保つ', same)
          // IMEの変換中の文字（CDPの合成入力。実IMEではない）も中断しない
          await c.send('Input.imeSetComposition', { text: 'れん', selectionStart: 2, selectionEnd: 2 })
          await sleep(150)
          same = await c.evaluate(`({ same: document.querySelector('input[aria-label="タイトルで絞り込み"]') === window.__search, focused: document.activeElement === window.__search, value: window.__search.value })`)
          assert(same.same && same.focused && same.value.includes('れん'), '変換中の入力を再マウントで中断しない（合成入力）', same)
          await c.insertText('れん')
          await sleep(100)
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '')
          await waitCount(c, '2 件表示 / 全 3 件', '検索のクリア')
          // 状態フィルター
          await c.click(`document.querySelector('[data-testid=top-bar] button[value=all]')`)
          await waitCount(c, '3 件表示 / 全 3 件', 'すべて')
          await c.click(`document.querySelector('[data-testid=top-bar] button[value=completed]')`)
          await waitCount(c, '1 件表示 / 全 3 件', '完了')
          await c.click(`document.querySelector('[data-testid=top-bar] button[value=open]')`)
          await waitCount(c, '2 件表示 / 全 3 件', '未完了')
          // 列見出しの並べ替え（Inbox）
          await c.click(`document.querySelector('main [aria-label^="タイトルで並べ替え"]')`)
          await sleep(200)
          const sorted = await c.evaluate(`[...document.querySelectorAll('[data-testid=task-list] [role=option]')].map((e) => e.getAttribute('aria-label').split('、')[0])`)
          assert(JSON.stringify(sorted) === JSON.stringify(['報告 A', '連絡 B']), 'Inboxの並べ替え', sorted)

          // 作成・完了・紐付け・削除に件数が追従する
          await c.click(`document.querySelector('main input[aria-label="タスクのタイトル"]')`)
          await c.insertText('追加 D')
          await c.enter()
          await waitCount(c, '3 件表示 / 全 4 件', '作成')
          // 行を指定して操作する（クリックで現在行にしてからキー操作）
          const row = (title) => `[...document.querySelectorAll('[data-testid=task-list] [role=option]')].find((e) => e.getAttribute('aria-label').startsWith(${JSON.stringify(title + '、')}))`
          await c.click(row('追加 D'))
          await c.space()
          await waitCount(c, '2 件表示 / 全 4 件', '完了の変更')
          await c.click(row('報告 A'))
          // フェーズ5.9: 削除は確認なし
          await c.key('Delete', 46)
          await waitCount(c, '1 件表示 / 全 3 件', '削除')
          await c.click(row('連絡 B'))
          await c.key('m', 77, { code: 'KeyM', text: 'm' })
          // メニューの位置決め・フォーカス移動が終わってから項目を押す
          await c.waitFor(`document.querySelector('[role=menu] [data-assign-project-id="${ids.p}"]') && document.querySelector('[role=menu]').contains(document.activeElement)`, 3000, '紐付けメニュー')
          await sleep(150)
          await c.click(`document.querySelector('[role=menu] [data-assign-project-id="${ids.p}"]')`)
          await c.waitFor(`document.querySelector('[role=menu] [data-assign-milestone-id="${ids.m2}"]') && document.querySelector('[role=menu]').contains(document.activeElement)`, 3000, 'マイルストンの選択')
          await sleep(150)
          await c.click(`document.querySelector('[role=menu] [data-assign-milestone-id="${ids.m2}"]')`)
          await waitCount(c, '0 件表示 / 全 2 件', '紐付け（所属変更）')
          // 0件の表示（この範囲のタスクが0件）
          await c.click(`document.querySelector('[data-testid=top-bar] button[value=all]')`)
          await waitCount(c, '2 件表示 / 全 2 件', 'すべて')
          // 画面の状態をメモ（別画面に適用されないことの確認用）
          await c.setInput('input[aria-label="タイトルで絞り込み"]', 'Inboxだけの検索')
          await waitCount(c, '0 件表示 / 全 2 件', 'Inboxの検索')

          // Project（選択中のプロジェクトの表示設定）。画面の切り替えで検索欄にフォーカスしない
          await openProject(c, ids.p)
          s = await shell(c)
          assert(s.searchInTop && s.filterInTop && s.sortInTop && !s.inMain.search && !s.inMain.filter && !s.inMain.sort && !s.inMain.count, 'Project: キーワード・状態・並べ替えがトップバーにまとまり、メインパネルに重複しない', s)
          assert(s.searchValue === '' && s.filterPressed === 'open', 'Inboxの検索・状態はプロジェクトへ持ち込まない（範囲ごとに初期化する従来の仕様）', s)
          assert(!(await c.evaluate(`document.activeElement?.matches('input[aria-label="タイトルで絞り込み"]')`)), '画面切り替えで検索欄にフォーカスしない')
          // 全マイルストンの合計（未完了3）。見出し・追加操作は数えない
          assert(s.count === '4 件表示 / 全 5 件', 'Projectの件数は全カードの合計（未完了: M1の2件＋M2の2件。完了1件を除く）', s.count)
          const cardSum = await c.evaluate(`[...document.querySelectorAll('[data-testid=milestone-card] [role=option]')].length`)
          assert(cardSum === 4, 'カードに表示しているタスクの合計と一致', cardSum)
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '報告')
          await waitCount(c, '2 件表示 / 全 5 件', 'Projectの検索（全カード共通）')
          const perCard = await c.evaluate(`[...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => e.querySelectorAll('[role=option]').length)`)
          assert(JSON.stringify(perCard) === JSON.stringify([1, 1]), '検索はプロジェクト内の全カードに共通に適用', perCard)
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '')
          await waitCount(c, '4 件表示 / 全 5 件', '検索のクリア')
          // トップバーの並べ替え（全カード共通）: フェーズ5.9から選択式（手動順・作成日時が古い順・新しい順・タイトル順）
          const m2Titles = () => c.evaluate(`[...document.querySelectorAll('[data-milestone-id="${ids.m2}"] [role=option]')].map((e) => e.getAttribute('aria-label').split('、')[0])`)
          const collate = (list) => [...list].sort(new Intl.Collator('ja', { numeric: true, sensitivity: 'base' }).compare)
          const chooseSort = async (key) => {
            await c.click(`document.querySelector('[data-testid=top-bar] [data-testid=view-sort-select] [role=combobox]')`)
            await c.waitFor(`document.querySelector('[data-sort-key=${key}]')`, 3000, '並べ替えの選択肢')
            await sleep(150)
            await c.click(`document.querySelector('[data-sort-key=${key}]')`)
            await c.waitFor(`!document.querySelector('[data-sort-key=${key}]')`, 3000, '選択肢を閉じる')
            await sleep(200)
          }
          await chooseSort('title')
          let order = await m2Titles()
          assert(order.length === 2 && JSON.stringify(order) === JSON.stringify(collate(order)), 'トップバーの並べ替えをカードに適用（タイトル順）', order)
          await chooseSort('created-asc')
          const ascending = await m2Titles()
          await chooseSort('created-desc')
          order = await m2Titles()
          assert(JSON.stringify(order) === JSON.stringify([...ascending].reverse()), '作成日時が新しい順は古い順の逆', { ascending, order })
          await chooseSort('manual')
          await c.click(`document.querySelector('[data-testid=top-bar] button[value=completed]')`)
          await waitCount(c, '1 件表示 / 全 5 件', 'Projectの完了')
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '報告')
          await waitCount(c, '0 件表示 / 全 5 件', 'Projectの完了と検索の組み合わせ')
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '')
          // 別のプロジェクトへ切り替えると、そのプロジェクトの表示設定（従来どおり検索は空・状態は未完了）と件数になる
          await openProject(c, ids.e)
          s = await shell(c)
          assert(s.searchValue === '' && s.filterPressed === 'open' && s.count === '0 件表示 / 全 0 件', '別のプロジェクト: 前のプロジェクトの設定・件数を残さない（0件は0件と表示）', s)

          // 設定・未保存の NEW PROJECT・/projects（未選択）では表示設定・件数を表示しない
          await c.click(`document.querySelector('nav button[aria-label="設定"]')`)
          await c.waitFor(`location.hash === '#/settings'`, 3000, '設定')
          await sleep(200)
          s = await shell(c)
          assert(s.slotChildren === 0 && !s.searchInTop && !s.filterInTop && s.count === '', '設定: トップバーの表示設定・ステータスバーの件数を表示しない', s)
          await c.click(`document.querySelector('[data-testid=new-project]')`)
          await c.waitFor(`location.hash === '#/projects/new'`, 3000, '新規画面')
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=project-name-editor] input')`, 3000, '名前欄にフォーカス（従来どおり）')
          s = await shell(c)
          assert(s.slotChildren === 0 && s.count === '', '未保存の NEW PROJECT: タスク一覧用の表示設定・件数を表示しない', s)
          await c.key('Escape', 27)
          await c.waitFor(`location.hash !== '#/projects/new'`, 3000, 'Escで戻る')
          await c.evaluate(`location.hash = '#/projects'`)
          await c.waitFor(`location.hash === '#/projects'`, 3000, '/projects')
          await sleep(200)
          s = await shell(c)
          assert(s.slotChildren === 0 && s.count === '', 'プロジェクト未選択: 表示設定・件数を表示しない', s)
          // Inboxへ戻ると、Inboxの表示設定（従来どおり画面を開き直すと初期値）と件数
          await openInbox(c)
          s = await shell(c)
          assert(s.searchInTop && s.searchValue === '' && s.filterPressed === 'open' && s.count === '0 件表示 / 全 2 件', 'Inboxへ戻ると Inbox の設定・件数（他画面の設定は適用しない）', s)
          assert(!(await c.evaluate(`document.activeElement?.matches('input[aria-label="タイトルで絞り込み"]')`)), 'Inboxへ戻っても検索欄にフォーカスしない')

          // 狭い幅（ウィンドウの最小幅）: トップバーの操作が重ならず・はみ出さず、ステータスバーの件数は中央で左右と重ならない
          await c.click(`document.querySelector('[data-testid=top-bar] button[value=all]')`)
          await waitCount(c, '2 件表示 / 全 2 件', 'すべて')
          for (const target of ['inbox', 'project']) {
            if (target === 'project') await openProject(c, ids.p)
            for (const width of [1200, MIN_WINDOW_WIDTH]) {
              await setViewport(c, width)
              await sleep(300)
              const o = await overlap(c)
              assert(o.topScroll <= 0 && o.controlsRight <= o.slotRight + 0.5 && o.controlsLeft >= o.slotLeft - 0.5 && o.controlsRight <= o.toggleLeft && o.toggleVisible && o.bodyScroll <= 0, `${target} ${width}px: トップバーの操作同士・切り替えボタンと重ならず、はみ出さない`, o)
              assert(Math.abs(o.statusCols[0] - o.statusCols[2]) <= 0.5 && Math.abs(o.countCenter - o.statusCenter) <= 1, `${target} ${width}px: 件数はステータスバー全体の中央（左右の列は同じ幅）`, o)
              assert(o.leftRight <= o.countLeft && o.countRight <= o.appLeft, `${target} ${width}px: 件数は左右の情報と重ならない`, o)
            }
          }
          await clearViewport(c)
          await sleep(200)
          // 件数の更新でフォーカスを奪わない
          await c.focus('[data-milestone-id] [data-testid=task-list]')
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '報告')
          const focusKept = await c.evaluate(`document.activeElement?.getAttribute('role')`)
          assert(focusKept === 'listbox', '件数が変わってもフォーカスを奪わない', focusKept)
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      'サイドバー・カードの最小幅: 区分と「未完了」の見出しなし（完了済みは非表示・データは残る）、最小幅180→108・240→144、狭い幅で省略表示・操作を維持、保存済みの幅は縮めない、保存',
      () =>
        withApp({ label: 'min-width', userDataDir: dir }, async (app) => {
          const c = app.cdp
          // 保存済みの幅（新しい範囲内）は縮めない
          const before = await workspace(c)
          ids.savedBefore = before
          ids.long = (await api(c, `window.gtd.projects.create({ name: 'とても長いプロジェクト名でサイドバーの幅に収まらない名前' })`)).id
          ids.done = (await api(c, `window.gtd.projects.create({ name: '完了した案件' })`)).id
          await api(c, `window.gtd.projects.setCompleted({ id: ${JSON.stringify(ids.done)}, completed: true })`)
          const dupA = (await api(c, `window.gtd.projects.create({ name: '同名' })`)).id
          const dupB = (await api(c, `window.gtd.projects.create({ name: '同名' })`)).id
          await api(c, `window.gtd.tasks.create({ title: 'カードに収まらないとても長いタスクのタイトルで省略表示の確認', projectId: ${JSON.stringify(ids.p)}, milestoneId: ${JSON.stringify(ids.m1)} })`)
          await api(c, `window.gtd.workspace.save({ ...${JSON.stringify(before)}, sidebarWidth: 260, milestoneCardWidth: 400 })`)
          await reload(c)
          let ws = await workspace(c)
          assert(ws.sidebarWidth === 260 && ws.milestoneCardWidth === 400, '保存済みの幅（範囲内）は読み込み時にそのまま', ws)

          // サイドバー: 区分・「未完了」の見出しがなく、未完了のプロジェクトだけを Project 配下に表示
          const nav = await c.evaluate(`(() => {
            const area = document.querySelector('#navigation-projects')
            const texts = [...area.querySelectorAll('*')].filter((e) => e.children.length === 0).map((e) => e.textContent.trim())
            return {
              sections: !!area.querySelector('[data-testid^=project-section-], .MuiListSubheader-root'),
              labels: texts.filter((t) => /^(未完了|完了済み)/.test(t)),
              items: [...area.querySelectorAll('[data-project-id]')].map((e) => e.dataset.projectId),
              listParent: area.querySelector('[data-testid=project-list]')?.parentElement === area,
              lastIsNew: [...area.querySelectorAll('[data-project-id], [data-testid=new-project]')].at(-1)?.dataset.testid === 'new-project',
              dup: [${JSON.stringify(dupA)}, ${JSON.stringify(dupB)}].map((id) => area.querySelector('[data-project-id="' + id + '"]')?.textContent)
            }
          })()`)
          assert(!nav.sections && nav.labels.length === 0, 'Projectセクションに「未完了」ラベル・完了済みの区分（見出し・折りたたみ・項目）はない', nav)
          assert(nav.items.includes(ids.p) && nav.items.includes(ids.long) && !nav.items.includes(ids.done) && nav.listParent && nav.lastIsNew, '未完了のプロジェクトは Project 配下にそのまま、完了済みは混ぜない、NEW PROJECT は最下段', nav)
          assert(nav.dup[0] !== nav.dup[1] && nav.dup.every((t) => t?.startsWith('同名')), '同名のプロジェクトは識別できる', nav.dup)
          const stored = await api(c, 'window.gtd.projects.list()')
          assert(stored.some((p) => p.id === ids.done && p.doneOn !== null), '完了済みのプロジェクトのデータは残る')

          // サイドバーの最小幅: 境界線をドラッグして最小（108px）まで。保存・はみ出しなし・操作は利用可能
          await openProject(c, ids.p)
          await dragSidebarTo(c, 0)
          await c.waitFor(`(async () => (await window.gtd.workspace.get()).data.sidebarWidth === ${SIDEBAR_MIN})()`, 3000, 'ドラッグで最小幅・保存')
          let sb = await sidebar(c)
          assert(Math.abs(sb.width - SIDEBAR_MIN) <= 1 && sb.mainLeft >= sb.navRight, `サイドバーは最小${SIDEBAR_MIN}px（従来180px）・メイン領域へはみ出さない`, sb)
          assert(sb.badge && sb.chevron && sb.newProject && sb.settings && sb.separator && !sb.navScroll, '狭くしてもバッジ・折りたたみ・NEW PROJECT・設定・幅のハンドルは利用可能（横スクロールなし）', sb)
          const longName = sb.names.find((n) => n.id === ids.long)
          assert(longName.clipped && longName.ellipsis === 'ellipsis' && sb.names.every((n) => n.inside), 'プロジェクト名は省略表示で収める', sb.names)
          // キーボード（境界線）でも最小幅より狭くならない
          await c.focus('[role=separator][aria-label^="ナビゲーションの幅"]')
          for (let i = 0; i < 3; i++) await c.key('ArrowLeft', 37)
          await sleep(400)
          sb = await sidebar(c)
          ws = await workspace(c)
          assert(Math.abs(sb.width - SIDEBAR_MIN) <= 1 && ws.sidebarWidth === SIDEBAR_MIN, 'キーボードでも最小幅は同じ', { sb: sb.width, ws: ws.sidebarWidth })
          // Main側の検証も同じ最小幅
          const below = await c.evaluate(`window.gtd.workspace.save({ ...${JSON.stringify(ws)}, sidebarWidth: ${SIDEBAR_MIN - 1} })`)
          const atMin = await c.evaluate(`window.gtd.workspace.save({ ...${JSON.stringify(ws)}, sidebarWidth: ${SIDEBAR_MIN} })`)
          assert(!below.ok && below.error.code === 'INVALID_INPUT' && atMin.ok, 'Mainの検証: 107pxは拒否・108pxは受け付ける', { below, atMin })

          // カードの最小幅（共通の幅）: Home で最小（144px）。中身は収まり、操作は利用可能
          ws = await workspace(c)
          assert(ws.milestoneCardWidth === 400, 'カードの保存済みの幅は変わっていない', ws)
          await c.focus('[data-testid=card-resize-handle]')
          await c.key('Home', 36)
          await c.waitFor(`(async () => (await window.gtd.workspace.get()).data.milestoneCardWidth === ${CARD_MIN})()`, 3000, 'Home で最小・保存')
          await sleep(300)
          let fit = await cardFit(c)
          assert(fit.width === CARD_MIN && fit.handle && fit.rename && fit.menu && fit.newTask, `カードは最小${CARD_MIN}px（従来240px）・見出しのメニュー・名前の変更・NEW TASK・幅のハンドルは利用可能`, fit)
          assert(fit.titlesInside && fit.anyClipped && fit.label.inside && !fit.rowsOverlap && fit.rowHeights.length === 1 && !fit.cardsOverlap, 'タスク名は省略表示でカードに収まり、行・カードが重ならない', fit)
          const handleAria = await c.evaluate(`document.querySelector('[data-testid=card-resize-handle]').getAttribute('aria-valuemin')`)
          assert(handleAria === String(CARD_MIN), 'ハンドルの最小値（ARIA）も同じ', handleAria)
          // ドラッグでも最小幅より狭くならない
          const h = await c.evaluate(`(() => { const e = document.querySelector('[data-testid=card-resize-handle]'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 40 } })()`)
          await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x, y: h.y })
          await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.x, y: h.y, button: 'left', buttons: 1, clickCount: 1 })
          await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x - 300, y: h.y, button: 'left', buttons: 1 })
          await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: h.x - 300, y: h.y, button: 'left', buttons: 0, clickCount: 1 })
          await sleep(300)
          assert((await workspace(c)).milestoneCardWidth === CARD_MIN && (await cardFit(c)).width === CARD_MIN, 'ドラッグでも最小幅は同じ')
          const cardBelow = await c.evaluate(`window.gtd.workspace.save({ ...${JSON.stringify(await workspace(c))}, milestoneCardWidth: ${CARD_MIN - 1} })`)
          assert(!cardBelow.ok && cardBelow.error.code === 'INVALID_INPUT', 'Mainの検証: 143pxは拒否', cardBelow)
          // 幅を変えた後も仮想リストのスクロールが整合する（末尾まで移動して最後の行が見える）
          await c.focus(`[data-milestone-id="${ids.m1}"] [data-testid=task-list]`)
          await c.key('End', 35)
          await sleep(200)
          const end = await c.evaluate(`(() => { const s = document.querySelector('[data-milestone-id="${ids.m1}"] [data-testid=task-list-scroll]'); return { overflowX: s.scrollWidth > s.clientWidth } })()`)
          assert(!end.overflowX, 'カード内に横方向のはみ出しがない', end)
          fit = await cardFit(c)
          assert(!fit.rowsOverlap && fit.titlesInside, '幅の変更後も行が重ならない', fit)

          // 狭いウィンドウでも保存済みの幅は書き換えない
          await c.focus('[data-testid=card-resize-handle]')
          await c.key('ArrowRight', 39)
          await c.waitFor(`(async () => (await window.gtd.workspace.get()).data.milestoneCardWidth === ${CARD_MIN + 16})()`, 3000, '→ で広げる')
          await api(c, `window.gtd.workspace.save({ ...${JSON.stringify(await workspace(c))}, sidebarWidth: 200 })`)
          await reload(c)
          await openProject(c, ids.p)
          await setViewport(c, MIN_WINDOW_WIDTH)
          await sleep(500)
          ws = await workspace(c)
          assert(ws.sidebarWidth === 200 && ws.milestoneCardWidth === CARD_MIN + 16, '狭いウィンドウでも保存済みの幅は縮めない', ws)
          const narrow = await sidebar(c)
          assert(narrow.mainLeft >= narrow.navRight && narrow.badge && narrow.chevron, '狭いウィンドウでもサイドバーはメイン領域へはみ出さない', narrow)
          await clearViewport(c)
          await sleep(300)
          // 最小幅で保存して終了（次のセッションで復元を確認する）
          await dragSidebarTo(c, 0)
          await c.waitFor(`(async () => (await window.gtd.workspace.get()).data.sidebarWidth === ${SIDEBAR_MIN})()`, 3000, '最小幅で保存')
          await c.focus('[data-testid=card-resize-handle]')
          await c.key('Home', 36)
          await c.waitFor(`(async () => (await window.gtd.workspace.get()).data.milestoneCardWidth === ${CARD_MIN})()`, 3000, 'カードを最小幅で保存')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      'サイドバー・カードの最小幅: 新しいアプリのセッションで最小幅（108・144）を復元し、完了済みのプロジェクトはサイドバーに出ない',
      () =>
        withApp({ label: 'min-width-restore', userDataDir: dir }, async (app) => {
          const c = app.cdp
          await c.waitFor(`location.hash === ${JSON.stringify(`#/projects/${ids.p}`)}`, 5000, '最後の画面')
          await c.waitFor(`document.querySelector('[data-testid=milestone-card]')`, 5000, 'カード')
          await sleep(400)
          const ws = await workspace(c)
          const sb = await sidebar(c)
          const fit = await cardFit(c)
          assert(ws.sidebarWidth === SIDEBAR_MIN && ws.milestoneCardWidth === CARD_MIN && Math.abs(sb.width - SIDEBAR_MIN) <= 1 && fit.width === CARD_MIN, '保存した最小幅を復元', { ws, sb: sb.width, card: fit.width })
          assert(!(await c.evaluate(`!!document.querySelector('#navigation-projects [data-project-id="${ids.done}"]')`)), '完了済みのプロジェクトはサイドバーに出ない')
          const s = await shell(c)
          assert(s.topHeight === TOP_BAR_HEIGHT && s.sortInTop && s.count.endsWith('件'), '再起動後もトップバー・件数の表示', s)
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      'ステータスバーの件数（大量データ・非表示データ）: 仮想化で描画した行数ではなく全表示対象（Inbox 2,000件・プロジェクト 1,200件）で数え、削除由来の非表示タスクは含めない',
      async () => {
        const db = await createDatabaseAt(join(bulkDir, 'gtd.sqlite'))
        const insert = db.prepare('INSERT INTO tasks (id, title, created_at, updated_at, done_on, project_id, milestone_id, hidden_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        const projectId = randomUUID()
        const milestones = [randomUUID(), randomUUID(), randomUUID()]
        db.prepare('INSERT INTO projects (id, name, created_at, updated_at, done_on) VALUES (?, ?, ?, ?, NULL)').run(projectId, '大量の案件', 'a', 'a')
        milestones.forEach((id, i) =>
          db.prepare('INSERT INTO milestones (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, projectId, `M${i + 1}`, `2026-11-0${i + 1}T00:00:00.000Z`, 'a')
        )
        db.transaction(() => {
          for (let i = 0; i < 2000; i++) {
            const at = new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString()
            insert.run(randomUUID(), `Inbox ${i}`, at, at, i % 4 === 0 ? at : null, null, null, null)
          }
          for (let i = 0; i < 1200; i++) {
            const at = new Date(Date.UTC(2026, 9, 2) + i * 1000).toISOString()
            insert.run(randomUUID(), `P ${i}`, at, at, i % 3 === 0 ? at : null, projectId, milestones[i % 3], null)
          }
          // 削除由来の非表示タスク（5.6の削除の結果と同じ形）。一覧にも件数にも出ない
          // - 削除したプロジェクトの配下だったもの: 所属なし（project_id・milestone_id とも NULL）
          // - 削除したマイルストンの配下だったもの: このプロジェクトの project_id のまま、milestone_id は NULL
          for (let i = 0; i < 50; i++) {
            const at = new Date(Date.UTC(2026, 9, 3) + i * 1000).toISOString()
            insert.run(randomUUID(), `非表示 ${i}`, at, at, null, i % 2 === 0 ? null : projectId, null, at)
          }
        })()
        db.close()
        await withApp({ label: 'count-bulk', userDataDir: bulkDir }, async (app) => {
          const c = app.cdp
          await c.waitFor(`location.hash === '#/inbox' && document.querySelector('[data-testid=task-list] [role=option]')`, 10000, 'Inbox')
          await sleep(300)
          await waitCount(c, '1500 件表示 / 全 2000 件', 'Inboxの件数')
          const rendered = await c.evaluate(`document.querySelectorAll('[data-testid=task-list] [role=option]').length`)
          assert(rendered > 0 && rendered < 200, '仮想化で描画しているのは一部の行だけ', rendered)
          await c.click(`document.querySelector('[data-testid=top-bar] button[value=all]')`)
          await waitCount(c, '2000 件表示 / 全 2000 件', 'すべて（非表示の50件は含めない）')
          const badge = await c.evaluate(`document.querySelector('[data-testid=nav-inbox-badge]').textContent`)
          assert(badge === '1500', 'サイドバーのInboxバッジは別用途のまま（未完了の件数）', badge)
          await openProject(c, projectId)
          await waitCount(c, '800 件表示 / 全 1200 件', 'Projectの件数（全マイルストンの合計）')
          const cardsRendered = await c.evaluate(`document.querySelectorAll('[data-testid=milestone-card] [role=option]').length`)
          assert(cardsRendered > 0 && cardsRendered < 400, 'カードも仮想化（描画は一部）', cardsRendered)
          await c.setInput('input[aria-label="タイトルで絞り込み"]', 'P 11')
          // P 11, P 110〜119, P 1100〜1199 のうち未完了（i % 3 !== 0）
          const expected = [11, ...Array.from({ length: 10 }, (_, k) => 110 + k), ...Array.from({ length: 100 }, (_, k) => 1100 + k)].filter((i) => i % 3 !== 0).length
          await waitCount(c, `${expected} 件表示 / 全 1200 件`, 'Projectの検索の件数')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
        const check = openDatabaseReadOnly(join(bulkDir, 'gtd.sqlite'))
        try {
          const hidden = check.prepare('SELECT COUNT(*) AS n FROM tasks WHERE hidden_at IS NOT NULL').get().n
          assert(hidden === 50, '非表示のタスクは残っている（表示設定の操作でデータを変えない）', hidden)
          const changed = check.prepare("SELECT COUNT(*) AS n FROM tasks WHERE updated_at <> created_at").get().n
          assert(changed === 0, '表示設定・件数の操作でタスクを更新しない', changed)
        } finally {
          check.close()
        }
      }
    ]
  ]
}
