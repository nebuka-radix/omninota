// 共通のタスク行（TaskRow）のUIシナリオ。run.mjs から呼ぶ。専用の一時userData・一時DBだけを使う。
// 日付は TZ=Asia/Tokyo とテスト用の時計（GTD_TEST_CLOCK_FILE。テストモードの Main だけが読む）で固定する。
// 確かめること: 3画面（Inbox・プロジェクトのカード・Summary Review）で同じ行、2行構成と操作の順、作成日時を出さない、
// 期限の表示（Today・Tomorrow・{N}Days・期限超過・未設定）と日付の変化、タスク名のクリック（モーダル）・ダブルクリック（インライン編集）・
// チェック・修飾キー・ドラッグの区別、キーボード、お気に入り（既定値・切り替え・連打・失敗・競合）、紐付けアイコン（3画面）、「…」は削除だけ。
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, clickWith, doubleClick, keyWith, MOD, mouseDown, mouseMoveTo, mouseUp, pointOf, requestQuit, sleep } from './lib.mjs'
import { readDb, rowOf, seedDatabase, U } from './scenarios-inbox-ops.mjs'

const require = createRequire(import.meta.url)

// UTC 2026-11-11 15:30 は、東京（UTC+9）では 2026-11-12 00:30
const START = '2026-11-11T15:30:00.000Z'

export function taskRowScenarios({ withApp, root }) {
  const clockFile = join(root, 'clock-task-row.json')
  const setClock = (at) => writeFileSync(clockFile, JSON.stringify({ at, setAt: Date.now() }))
  const env = { TZ: 'Asia/Tokyo', GTD_TEST_CLOCK_FILE: clockFile }
  const BASE = '2026-11-01T00:00:00.000Z'
  const at = (s) => new Date(Date.parse(BASE) + s * 1000).toISOString()
  const T = (n) => U(70000 + n)
  const P1 = 'a7000000-0000-4000-8000-000000000001'
  const P2 = 'a7000000-0000-4000-8000-000000000002'
  const P3 = 'a7000000-0000-4000-8000-000000000003'
  const P4 = 'a7000000-0000-4000-8000-000000000004'
  const M1 = 'b7000000-0000-4000-8000-000000000001'
  const M2 = 'b7000000-0000-4000-8000-000000000002'
  const M3 = 'b7000000-0000-4000-8000-000000000003'
  const M4 = 'b7000000-0000-4000-8000-000000000004'
  const projects = [
    { id: P1, name: '案件A', createdAt: at(1) },
    { id: P2, name: '案件B', createdAt: at(2) },
    { id: P3, name: '完了済み案件', createdAt: at(3), doneOn: at(50) },
    { id: P4, name: '空の案件', createdAt: at(4) }
  ]
  const milestones = [
    { id: M1, projectId: P1, name: '設計', createdAt: at(5) },
    { id: M2, projectId: P1, name: '実装', createdAt: at(6) },
    { id: M3, projectId: P2, name: '調査', createdAt: at(7) },
    { id: M4, projectId: P3, name: '完了済みM', createdAt: at(8) }
  ]

  const titleOf = (id) => `document.querySelector('[data-task-row][data-task-id="${id}"] [data-testid=task-title]')`
  const control = (id, testId) => `document.querySelector('[data-task-row-controls="${id}"] [data-testid=${testId}]')`
  const api = (c, expression) =>
    c.evaluate(`(${expression}).then((r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data })`)
  const dbRow = (dir, id) => readDb(dir, 'SELECT * FROM tasks WHERE id = ?', id)[0]
  const editDialog = `document.querySelector('[data-testid=task-edit-dialog]')`
  const editTitleInput = `document.querySelector('[data-testid=task-edit-dialog] [data-testid=task-editor] input:not([type=hidden])')`
  const inlineInput = `document.querySelector('[data-testid=inline-title-editor] input')`
  const listFocused = `document.activeElement?.getAttribute('role') === 'listbox'`
  // 編集モーダルが開いた回数を数える（開いてはいけない操作の確認）
  const watchEditDialog = (c) =>
    c.evaluate(`(() => { window.__editOpened = 0; let open = false; new MutationObserver(() => { const now = !!document.querySelector('[data-testid=task-edit-dialog]'); if (now && !open) window.__editOpened++; open = now }).observe(document.body, { childList: true, subtree: true }); return true })()`)
  const editOpened = (c) => c.evaluate('window.__editOpened')
  const waitInbox = async (c) => {
    await c.waitFor(`location.hash === '#/inbox' && document.querySelector('[data-testid=task-list] [role=option]')`, 10000, 'Inbox')
    await sleep(300)
  }
  const openSummary = async (c) => {
    await c.click(`document.querySelector('nav button[aria-label="Summary Review"]')`)
    await c.waitFor(`location.hash === '#/summary' && document.querySelector('[data-testid=summary-review]')`, 5000, 'Summary Review')
    await sleep(400)
  }
  const openInbox = async (c) => {
    await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
    await waitInbox(c)
  }
  const openProject = async (c, id) => {
    await c.evaluate(`location.hash = ${JSON.stringify(`#/projects/${id}`)}`)
    await c.waitFor(`document.querySelector('[data-testid=milestone-board]')`, 5000, 'プロジェクト')
    await sleep(300)
  }
  // 行の構造（1行目: チェック・タスク名、2行目: 右寄せの操作）と重なり
  const structure = (c, id) =>
    c.evaluate(`(() => {
      const row = document.querySelector('[data-task-row][data-task-id="${id}"]')
      const controls = document.querySelector('[data-task-row-controls="${id}"]')
      if (!row || !controls) return null
      const r = (e) => e.getBoundingClientRect()
      const check = r(row.querySelector('input[type=checkbox]'))
      const title = r(row.querySelector('[data-testid=task-title]'))
      const rowRect = r(row)
      const buttons = [...controls.querySelectorAll('button')].filter((b) => b.closest('[data-testid=inline-title-editor-row]') === null)
      const rects = buttons.map((b) => r(b))
      const handle = row.closest('[data-testid=task-list-scroll]')?.querySelector('[data-reorder-task-id="${id}"]')
      let overlap = false
      for (let i = 1; i < rects.length; i++) if (rects[i].left < rects[i - 1].right - 0.5) overlap = true
      return {
        variant: row.closest('[role=listbox]')?.dataset.variant ?? null,
        order: buttons.map((b) => b.dataset.testid),
        line1: check.top < rowRect.top + 30 && title.top < rowRect.top + 30 && check.right <= title.left + 0.5,
        line2: rects.every((x) => x.top >= title.bottom - 0.5 && x.bottom <= rowRect.bottom + 0.5),
        // 2行目は左寄せ: 星のアイコンの左端 = タスク名の文字の左端
        starIconLeft: r(controls.querySelector('[data-testid=task-favorite] svg')).left,
        titleTextLeft: title.left + parseFloat(getComputedStyle(row.querySelector('[data-testid=task-title]')).paddingLeft),
        assignment: (() => { const a = controls.querySelector('[data-testid=task-assignment]'); if (!a) return null; const ar = r(a); return { text: a.textContent, title: a.title, left: ar.left, right: ar.right, truncated: a.scrollWidth > a.clientWidth, top: ar.top } })(),
        lastButtonRight: rects.length > 0 ? rects.at(-1).right : null,
        buttonWidths: rects.map((x) => Math.round(x.width)),
        overlap,
        titleInside: title.right <= rowRect.right + 0.5,
        rowRight: rowRect.right,
        controlsInListbox: !!controls.closest('[role=listbox]'),
        controlsInOption: !!controls.closest('[role=option]'),
        focusableInOption: row.querySelectorAll('button, [role=button], a[href], [tabindex="0"]').length,
        handleLeft: handle ? r(handle).right <= check.left + 0.5 : null,
        dateText: /\\d{4}\\/\\d{2}\\/\\d{2}\\s\\d{2}:\\d{2}/.test(row.innerText + controls.innerText)
      }
    })()`)
  const expectRow = (s, label, { due = 'task-due', handle = false } = {}) => {
    assert(s !== null, `${label}: 行がある`)
    const order = ['task-favorite', due, 'task-assign', 'task-row-menu-button']
    assert(JSON.stringify(s.order) === JSON.stringify(order), `${label}: 2行目の操作の順（星・期限・紐付け・…）`, s)
    assert(s.line1 && s.line2 && Math.abs(s.starIconLeft - s.titleTextLeft) <= 0.5 && !s.overlap && s.titleInside, `${label}: 2行構成（1行目 チェック・タスク名、2行目 左寄せで星とタスク名の左端が揃う）で重ならない`, s)
    if (s.assignment) assert(s.assignment.left >= s.lastButtonRight - 0.5 && s.assignment.right <= s.rowRight + 0.5, `${label}: 所属は「…」の右・行の中`, s)
    assert(s.buttonWidths.filter((w, i) => s.order[i] !== 'task-due').every((w) => w === 20), `${label}: 操作アイコンの幅は保つ`, s)
    assert(!s.controlsInListbox && !s.controlsInOption && s.focusableInOption === 0, `${label}: 操作ボタンは listbox/option の外`, s)
    assert(!s.dateText, `${label}: 作成日時を表示しない`, s)
    if (handle) assert(s.handleLeft === true, `${label}: 手動順のハンドルは左側に独立`, s)
  }
  const dueOf = (c, id) =>
    c.evaluate(`(() => { const e = ${control(id, 'task-due')}; if (!e) return { set: !!${control(id, 'task-due-set')} }; return { kind: e.dataset.dueKind, text: e.textContent, label: e.getAttribute('aria-label') } })()`)

  return [
    [
      'TaskRow: 3画面で共通の行（2行構成・操作の順・作成日時なし・listbox の外の操作）、期限の表示（Today・Tomorrow・2Days・期限超過・未設定）、日付の変化、column／row・狭い幅',
      async () => {
        const dir = join(root, 'userData-task-row-layout')
        setClock(START)
        await seedDatabase(dir, {
          projects,
          milestones,
          tasks: [
            { id: T(1), title: 'Today行', createdAt: at(10), dueto: '2026-11-12' },
            { id: T(2), title: 'Tomorrow行', createdAt: at(11), dueto: '2026-11-13' },
            { id: T(3), title: '2Days行', createdAt: at(12), dueto: '2026-11-14' },
            { id: T(4), title: '期限超過行', createdAt: at(13), dueto: '2026-11-10' },
            { id: T(5), title: '期限なし行', createdAt: at(14) },
            { id: T(6), title: 'お気に入り行', createdAt: at(15), favorite: true },
            { id: T(7), title: 'カード行（とても長い名前で、狭い幅でも操作と重ならないことを確かめる）', createdAt: at(16), dueto: '2026-11-12', projectId: P1, milestoneId: M1 },
            { id: T(8), title: 'カード行2', createdAt: at(17), projectId: P1, milestoneId: M1 }
          ]
        })
        await withApp({ label: 'task-row-layout', userDataDir: dir, extraEnv: env }, async (app) => {
          const c = app.cdp
          await waitInbox(c)
          // Inbox
          for (const n of [1, 2, 3, 4, 6]) expectRow(await structure(c, T(n)), `Inbox ${n}`, { due: n === 6 ? 'task-due-set' : 'task-due' })
          expectRow(await structure(c, T(5)), 'Inbox 期限なし', { due: 'task-due-set' })
          const inboxAssignment = await c.evaluate(`({ el: !!document.querySelector('[data-task-row-controls="${T(5)}"] [data-testid=task-assignment]'), text: document.querySelector('[data-task-row-controls="${T(5)}"]').textContent })`)
          assert(!inboxAssignment.el && !inboxAssignment.text.includes('/') && !inboxAssignment.text.includes('null'), '所属のない Inbox のタスクは所属を表示しない（区切り文字・null なし）', inboxAssignment)
          assert((await structure(c, T(1))).variant === 'table', 'Inbox の一覧')
          const header = await c.evaluate(`[...document.querySelectorAll('main button[aria-label*="並べ替え"]')].map((b) => b.textContent)`)
          assert(header.includes('作成日時'), '作成日時での並べ替えは残す（列は表示しない）', header)
          // 期限の表示
          const labels = {}
          for (const n of [1, 2, 3, 4, 5]) labels[n] = await dueOf(c, T(n))
          assert(labels[1].text === 'Today' && labels[1].kind === 'today', 'Today', labels)
          assert(labels[2].text === 'Tomorrow' && labels[2].kind === 'tomorrow', 'Tomorrow', labels)
          assert(labels[3].text === '2Days' && labels[3].kind === 'days', '明後日は 2Days', labels)
          assert(labels[4].kind === 'overdue' && labels[4].text === '11/10(火)' && labels[4].label.includes('期限超過'), '昨日以前は日付そのもの・期限超過', labels)
          assert(labels[5].set === true, '未設定は期限設定アイコン', labels)
          // お気に入りの表示（色だけでなく形・aria-pressed・ツールチップ）
          const stars = await c.evaluate(`[${JSON.stringify(T(6))}, ${JSON.stringify(T(5))}].map((id) => { const b = document.querySelector('[data-task-row-controls="' + id + '"] [data-testid=task-favorite]'); return { pressed: b.getAttribute('aria-pressed'), name: b.getAttribute('aria-label'), title: b.title, fill: b.querySelector('svg').getAttribute('fill'), color: getComputedStyle(b).color } })`)
          assert(stars[0].pressed === 'true' && stars[0].fill !== 'none' && stars[1].pressed === 'false' && stars[1].fill === 'none', 'お気に入りは塗りつぶし、未設定は白抜き（aria-pressed）', stars)
          assert(stars[1].name.includes('お気に入り') && stars[1].title === 'お気に入りに追加' && stars[0].title.includes('解除'), 'アクセシブル名・ツールチップ', stars)
          const assignIcon = await c.evaluate(`(() => { const b = ${control(T(5), 'task-assign')}; return { text: b.textContent.trim(), label: b.getAttribute('aria-label'), title: b.title, icon: !!b.querySelector('svg') } })()`)
          assert(assignIcon.text === '' && assignIcon.icon && assignIcon.label.includes('紐付け') && assignIcon.title.includes('紐付け'), '紐付けはアイコンだけ（文字なし）・ツールチップとアクセシブル名あり', assignIcon)

          // プロジェクトのカード（手動順のハンドルは左側）
          await openProject(c, P1)
          expectRow(await structure(c, T(7)), 'カード', { handle: true })
          expectRow(await structure(c, T(8)), 'カード 期限なし', { due: 'task-due-set', handle: true })
          assert((await structure(c, T(7))).variant === 'card', 'カードの一覧')
          // 最小のカード幅（column）
          await c.focus('[data-testid=card-resize-handle]')
          await keyWith(c, 'Home', 36)
          await sleep(400)
          let narrow = await structure(c, T(7))
          expectRow(narrow, 'カード（最小幅）', { handle: true })
          assert(narrow.assignment?.text === '案件A / 設計' && narrow.assignment.title === '案件A / 設計', '「…」の右に {プロジェクト名} / {マイルストン名}', narrow.assignment)
          // 名前の変更を反映し、狭い幅では右端を省略（全文はツールチップ）。操作アイコンの幅は保つ
          const renameProject = async (name) => {
            await c.click(`document.querySelector('button[aria-label="プロジェクト名を変更"]')`)
            await c.waitFor(`document.querySelector('[data-testid=project-name-editor] input')`, 3000, 'プロジェクト名の編集')
            await c.setInput('[data-testid=project-name-editor] input', name)
            await c.focus('[data-testid=project-name-editor] input')
            await c.enter()
            await c.waitFor(`document.querySelector('[data-testid=project-name]')?.textContent === ${JSON.stringify(name)}`, 5000, '名前の保存')
          }
          await renameProject('名前を変えたとても長いプロジェクトの名前')
          await c.waitFor(`document.querySelector('[data-task-row-controls="${T(7)}"] [data-testid=task-assignment]')?.textContent === '名前を変えたとても長いプロジェクトの名前 / 設計'`, 5000, '所属の名前の更新')
          narrow = await structure(c, T(7))
          expectRow(narrow, 'カード（最小幅・長い所属）', { handle: true })
          assert(narrow.assignment.truncated && narrow.assignment.title === '名前を変えたとても長いプロジェクトの名前 / 設計', '1行で右端を省略し、全文はツールチップ', narrow.assignment)
          const rowHeight = await c.evaluate(`document.querySelector('[data-task-row][data-task-id="${T(7)}"]').getBoundingClientRect().height`)
          assert(Math.round(rowHeight) === 52, '所属を折り返さず2行のまま', rowHeight)
          await renameProject('案件A')
          // row レイアウト
          await c.click(`document.querySelector('[data-testid=view-layout] button[value=row]')`)
          await sleep(500)
          expectRow(await structure(c, T(7)), 'カード（row）', { handle: true })
          await c.click(`document.querySelector('[data-testid=view-layout] button[value=column]')`)
          await sleep(300)
          await c.focus('[data-testid=card-resize-handle]')
          await keyWith(c, 'End', 35)
          await sleep(300)

          // Summary Review
          await openSummary(c)
          for (const n of [1, 2, 3, 7]) expectRow(await structure(c, T(n)), `Summary ${n}`)
          assert((await structure(c, T(1))).variant === 'section', 'Summary の一覧')
          const types = await c.evaluate(`[...new Set([...document.querySelectorAll('[data-task-row]')].map((e) => e.tagName + ':' + e.getAttribute('role')))]`)
          assert(JSON.stringify(types) === JSON.stringify(['DIV:option']), '同じ行の部品', types)

          // 日付の変化（再フォーカス）: 東京 11/13 になる。行ごとのタイマーではなく、アプリ全体の日付で表示を更新する
          setClock('2026-11-12T15:10:00.000Z')
          await c.evaluate(`window.dispatchEvent(new Event('focus'))`)
          await c.waitFor(`document.querySelector('[data-testid=summary-review]')?.dataset.today === '2026-11-13'`, 5000, '新しい日付')
          await sleep(300)
          await openInbox(c)
          const after = {}
          for (const n of [1, 2, 3]) after[n] = await dueOf(c, T(n))
          assert(after[1].kind === 'overdue' && after[1].text === '11/12(木)' && after[2].text === 'Today' && after[3].text === 'Tomorrow', '日付が変わると表示も変わる', after)
          setClock(START)
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ],
    [
      'TaskRow: タスク名のクリックで編集モーダル（初期フォーカス・保存・Esc・未保存の確認・フォーカス復帰・詳細を開かない）、ダブルクリックはインライン編集だけ、チェック・⌘／Shift・ドラッグ・並べ替えでは開かない、キーボード（E・F・D・M・Shift+F10・F2）',
      async () => {
        const dir = join(root, 'userData-task-row-click')
        setClock(START)
        await seedDatabase(dir, {
          projects,
          milestones,
          tasks: [
            ...Array.from({ length: 6 }, (_, i) => ({ id: T(20 + i), title: `クリック${i}`, createdAt: at(20 + i), dueto: i === 0 ? '2026-11-12' : null })),
            { id: T(30), title: 'カードの行', createdAt: at(30), projectId: P1, milestoneId: M1 },
            { id: T(31), title: 'カードの行2', createdAt: at(31), projectId: P1, milestoneId: M1 },
            { id: T(32), title: 'Summaryの行', createdAt: at(32), dueto: '2026-11-12' },
            { id: T(33), title: 'Summaryの行2', createdAt: at(33), dueto: '2026-11-12', projectId: P1, milestoneId: M2 }
          ]
        })
        await withApp({ label: 'task-row-click', userDataDir: dir, extraEnv: env }, async (app) => {
          const c = app.cdp
          await waitInbox(c)
          await watchEditDialog(c)
          const selected = () => c.evaluate(`[...document.querySelectorAll('[data-testid=task-list] [aria-selected=true]')].map((e) => e.dataset.taskId)`)

          // チェックボックス: 完了を保存し、モーダル・選択は変えない
          await c.click(`document.querySelector('[data-task-id="${T(21)}"] input[type=checkbox]')`)
          await c.waitFor(`!document.querySelector('[data-task-id="${T(21)}"]')`, 5000, '完了して未完了の一覧から外れる')
          await sleep(500)
          assert(dbRow(dir, T(21)).done_on !== null && (await editOpened(c)) === 0 && (await selected(c)).length === 0, 'チェックは完了だけ（モーダル・選択なし）', { opened: await editOpened(c) })

          // タスク名のシングルクリック → 編集モーダル（タイトルに初期フォーカス・既存の名前）。右の詳細は開かない
          await c.click(titleOf(T(22)))
          await c.waitFor(`${editDialog} && document.activeElement === ${editTitleInput}`, 3000, 'モーダルとタイトルへのフォーカス')
          const opened = await c.evaluate(`({ value: ${editTitleInput}.value, panel: document.querySelector('[data-inbox-panel]')?.dataset.inboxPanel, selected: document.querySelectorAll('[data-testid=task-list] [aria-selected=true]').length, dialogTask: ${editDialog}.dataset.taskId })`)
          assert(opened.value === 'クリック2' && opened.panel === 'targets' && opened.selected === 0 && opened.dialogTask === T(22), 'モーダルだけを開き、右の詳細・選択は変えない', opened)
          // 保存（Enter）→ 閉じる（Esc）→ 一覧へフォーカス
          await c.setInput('[data-testid=task-edit-dialog] [data-testid=task-editor] input:not([type=hidden])', 'クリック2 改')
          await c.enter()
          await c.waitFor(`${editDialog}?.textContent.includes('未保存の変更があります') === false`, 3000, '保存')
          await sleep(200)
          assert(dbRow(dir, T(22)).title === 'クリック2 改', 'モーダルで保存（既存の保存の経路）', dbRow(dir, T(22)))
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!${editDialog} && ${listFocused}`, 3000, 'Esc で閉じて一覧へフォーカス')
          assert((await c.evaluate(`${titleOf(T(22))}.textContent`)) === 'クリック2 改', '一覧の名前も更新')

          // 未保存のまま閉じる → 既存の確認（キャンセルなら開いたまま・破棄なら保存しない）
          await c.click(titleOf(T(23)))
          await c.waitFor(`document.activeElement === ${editTitleInput}`, 3000, 'モーダル')
          await c.setInput('[data-testid=task-edit-dialog] [data-testid=task-editor] input:not([type=hidden])', '未保存')
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`[...document.querySelectorAll('[role=dialog]')].some((d) => d.innerText.includes('タスクのタイトルの変更を保存しますか'))`, 3000, '未保存の確認')
          await c.click(c.byText('[role=dialog] button', 'キャンセル'))
          await sleep(300)
          assert((await c.evaluate(`${editTitleInput}?.value`)) === '未保存', 'キャンセルではモーダルと入力を残す')
          await c.click(`document.querySelector('[data-testid=task-edit-dialog-close]')`)
          await c.waitFor(`[...document.querySelectorAll('[role=dialog]')].some((d) => d.innerText.includes('タスクのタイトルの変更を保存しますか'))`, 3000, '未保存の確認（閉じるボタン）')
          await c.click(c.byText('[role=dialog] button', '破棄'))
          await c.waitFor(`!${editDialog}`, 3000, '破棄して閉じる')
          assert(dbRow(dir, T(23)).title === 'クリック3', '破棄では保存しない')

          // ダブルクリック → インライン編集だけ（モーダルは開かない）
          const before = await editOpened(c)
          await doubleClick(c, titleOf(T(24)))
          await c.waitFor(`document.activeElement === ${inlineInput}`, 3000, 'インライン編集')
          await sleep(600)
          assert((await editOpened(c)) === before, 'ダブルクリックではモーダルを開かない', { before, after: await editOpened(c) })
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!${inlineInput}`, 3000, 'Esc')

          // ⌘・Shift 付きのタスク名のクリックは複数選択（モーダルは開かない）
          await clickWith(c, titleOf(T(24)), MOD.meta)
          await clickWith(c, titleOf(T(22)), MOD.shift)
          await sleep(600)
          const multi = await selected(c)
          assert(multi.length === 3 && (await editOpened(c)) === before, '⌘／Shift＋タスク名は選択だけ', { multi, opened: await editOpened(c) })
          // 行の背景のクリックは従来どおりの選択（単一）
          await c.click(rowOf(T(25)))
          await sleep(500)
          assert(JSON.stringify(await selected(c)) === JSON.stringify([T(25)]) && (await editOpened(c)) === before, '行の背景のクリックは選択（モーダルなし）')

          // タスク名からドラッグを始めてもモーダルを開かない（Esc で取り消し）
          const from = await pointOf(c, titleOf(T(24)))
          await mouseDown(c, from)
          await mouseMoveTo(c, from, { x: from.x + 40, y: from.y + 30 }, 6)
          await c.waitFor(`document.querySelector('[data-testid=task-drag-preview]')`, 2000, 'ドラッグ中')
          await keyWith(c, 'Escape', 27)
          await mouseUp(c, { x: from.x + 40, y: from.y + 30 })
          await sleep(600)
          assert((await editOpened(c)) === before && dbRow(dir, T(24)).project_id === null, 'ドラッグはクリックとして扱わない')

          // キーボード: E（モーダル）・F（お気に入り）・D（期限）・M（紐付け）・Shift+F10（「…」）・F2（インライン）
          await c.focus('[data-testid=task-list]')
          await keyWith(c, 'Home', 36)
          const current = await c.evaluate(`document.getElementById(document.querySelector('[data-testid=task-list]').getAttribute('aria-activedescendant'))?.dataset.taskId`)
          await c.key('e', 69, { code: 'KeyE', text: 'e' })
          await c.waitFor(`${editDialog}?.dataset.taskId === ${JSON.stringify(current)} && document.activeElement === ${editTitleInput}`, 3000, 'E でモーダル')
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!${editDialog} && ${listFocused}`, 3000, '閉じて一覧へ')
          await c.key('f', 70, { code: 'KeyF', text: 'f' })
          await c.waitFor(`${control(current, 'task-favorite')}.getAttribute('aria-pressed') === 'true'`, 3000, 'F でお気に入り')
          await sleep(300)
          assert(dbRow(dir, current).favorite === 1, 'F の結果を保存')
          await c.key('d', 68, { code: 'KeyD', text: 'd' })
          await c.waitFor(`document.querySelector('[data-testid=task-due-menu] [role=menu]')?.contains(document.activeElement)`, 3000, 'D で期限のメニュー')
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=task-due-menu]') && ${listFocused}`, 3000, '閉じて一覧へ')
          await c.key('m', 77, { code: 'KeyM', text: 'm' })
          await c.waitFor(`document.querySelector('[data-testid=assign-menu] [role=menu]')?.contains(document.activeElement)`, 3000, 'M で紐付けメニュー')
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=assign-menu]')`, 3000, '閉じる')
          await c.focus('[data-testid=task-list]')
          await keyWith(c, 'F10', 121, MOD.shift)
          await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')?.contains(document.activeElement)`, 3000, 'Shift+F10 で「…」')
          const items = await c.evaluate(`[...document.querySelectorAll('[data-testid=task-row-menu] [role=menuitem]')].map((e) => e.textContent)`)
          assert(JSON.stringify(items) === JSON.stringify(['削除']), '「…」は削除だけ', items)
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=task-row-menu]') && ${listFocused}`, 3000, '閉じて一覧へ')
          await keyWith(c, 'F2', 113)
          await c.waitFor(`document.activeElement === ${inlineInput}`, 3000, 'F2 でインライン編集')
          await keyWith(c, 'Escape', 27)

          // プロジェクトのカード: クリック → モーダル、ダブルクリック → インライン、並べ替えのハンドルのドラッグでは開かない
          await openProject(c, P1)
          await c.click(titleOf(T(30)))
          await c.waitFor(`${editDialog}?.dataset.taskId === ${JSON.stringify(T(30))}`, 3000, 'カードでモーダル')
          assert(!(await c.evaluate(`!!document.querySelector('#detail-panel [data-testid=task-editor]')`)), 'カードでも右の詳細は開かない')
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!${editDialog}`, 3000, '閉じる')
          const beforeCard = await editOpened(c)
          await doubleClick(c, titleOf(T(30)))
          await c.waitFor(`document.activeElement === ${inlineInput}`, 3000, 'カードでインライン編集')
          await keyWith(c, 'Escape', 27)
          // 並べ替えは絞り込みなし（状態「すべて」）の時だけ
          await c.click(`document.querySelector('[data-testid=view-status] button[value=all]')`)
          await sleep(300)
          const handle = await pointOf(c, `document.querySelector('[data-reorder-task-id="${T(30)}"]')`)
          await mouseDown(c, handle)
          await mouseMoveTo(c, handle, { x: handle.x, y: handle.y + 60 }, 6)
          await mouseUp(c, { x: handle.x, y: handle.y + 60 })
          await sleep(800)
          assert((await editOpened(c)) === beforeCard, 'ダブルクリック・並べ替えのドラッグではモーダルを開かない')
          const order = readDb(dir, 'SELECT id FROM tasks WHERE milestone_id = ? ORDER BY position', M1).map((r) => r.id)
          assert(JSON.stringify(order) === JSON.stringify([T(31), T(30)]), '並べ替えは保存する', order)

          // Summary Review: クリック → モーダル。チェックで完了すると保存後に一覧から外れる（件数も）
          await openSummary(c)
          await c.click(titleOf(T(32)))
          await c.waitFor(`${editDialog}?.dataset.taskId === ${JSON.stringify(T(32))} && document.activeElement === ${editTitleInput}`, 3000, 'Summary でモーダル')
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!${editDialog} && ${listFocused}`, 3000, '閉じて一覧へ')
          const countBefore = await c.evaluate(`document.querySelector('[data-testid=status-center]').textContent`)
          await c.click(`document.querySelector('[data-task-row][data-task-id="${T(32)}"] input[type=checkbox]')`)
          await c.waitFor(`!document.querySelector('[data-task-row][data-task-id="${T(32)}"]')`, 5000, '完了したタスクは Summary から外れる')
          const countAfter = await c.evaluate(`document.querySelector('[data-testid=status-center]').textContent`)
          assert(dbRow(dir, T(32)).done_on !== null && countBefore === '3 件' && countAfter === '2 件', '完了を保存し、件数も更新', { countBefore, countAfter })
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ],
    [
      'お気に入り: 既定値 false・切り替え（塗りつぶし／白抜き・aria-pressed）・連打（最後の状態を保存）・タイトル保存との競合・保存失敗（理由と保存済みの値へ戻す）・Summary と Inbox で同じ値',
      async () => {
        const dir = join(root, 'userData-task-row-favorite')
        const dbFile = join(dir, 'gtd.sqlite')
        setClock(START)
        await seedDatabase(dir, {
          tasks: [
            { id: T(40), title: '星A', createdAt: at(40), dueto: '2026-11-12' },
            { id: T(41), title: '星B', createdAt: at(41) }
          ]
        })
        const lockDb = () => {
          const Database = require('better-sqlite3')
          const locker = new Database(dbFile)
          locker.exec('BEGIN IMMEDIATE')
          return () => {
            locker.exec('ROLLBACK')
            locker.close()
          }
        }
        const pressed = (c, id) => c.evaluate(`${control(id, 'task-favorite')}.getAttribute('aria-pressed')`)
        await withApp({ label: 'task-row-favorite', userDataDir: dir, extraEnv: env }, async (app) => {
          const c = app.cdp
          await waitInbox(c)
          // 新規タスクの既定値は false
          await c.focus('input[aria-label="タスクのタイトル"]')
          await c.insertText('新しい星')
          await c.enter()
          await c.waitFor(`[...document.querySelectorAll('[data-task-row] [data-testid=task-title]')].some((e) => e.textContent === '新しい星')`, 5000, '追加')
          const created = readDb(dir, "SELECT id, favorite FROM tasks WHERE title = '新しい星'")[0]
          assert(created.favorite === 0 && (await pressed(c, created.id)) === 'false', '新しいタスクは false（白抜き）', created)
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)

          // 切り替え: 押した直後に表示を変え、お気に入りだけを保存する（他の項目は変えない）
          const before = dbRow(dir, T(41))
          await c.click(control(T(41), 'task-favorite'))
          assert((await pressed(c, T(41))) === 'true', '押した直後に塗りつぶし')
          await sleep(400)
          const after = dbRow(dir, T(41))
          assert(after.favorite === 1 && after.title === before.title && after.dueto === before.dueto && after.done_on === before.done_on && after.updated_at !== before.updated_at, 'お気に入りだけを保存', { before, after })
          assert((await c.evaluate(`document.activeElement === document.body || document.activeElement?.dataset.testid !== 'task-favorite'`)), '星を押してもフォーカスは星へ移らない')

          // 連打: 5回押す（true → false → true → false → true → false）→ 最後の状態（false）を保存する
          await c.evaluate(`(() => { const b = ${control(T(41), 'task-favorite')}; for (let i = 0; i < 5; i++) b.click() })()`)
          assert((await pressed(c, T(41))) === 'false', '最後に押した状態を表示')
          for (let i = 0; i < 30 && dbRow(dir, T(41)).favorite !== 0; i++) await sleep(100)
          await sleep(500)
          assert(dbRow(dir, T(41)).favorite === 0 && (await pressed(c, T(41))) === 'false', '連打しても最後の状態を保存し、表示と一致', dbRow(dir, T(41)))
          assert(!(await c.evaluate(`!!document.querySelector('[data-testid=task-favorite-error]')`)), 'エラーなし')

          // タイトルのインライン保存と同時に押しても、どちらも保存する（古いDTOで上書きしない）
          await doubleClick(c, titleOf(T(41)))
          await c.waitFor(`document.activeElement === ${inlineInput}`, 3000, 'インライン編集')
          await c.setInput('[data-testid=inline-title-editor] input', '星B 改')
          await c.evaluate(`(() => { ${inlineInput}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); ${control(T(41), 'task-favorite')}.click() })()`)
          await c.waitFor(`!${inlineInput}`, 3000, '保存')
          await sleep(600)
          const both = dbRow(dir, T(41))
          assert(both.title === '星B 改' && both.favorite === 1 && (await pressed(c, T(41))) === 'true' && (await c.evaluate(`${titleOf(T(41))}.textContent`)) === '星B 改', 'タイトルとお気に入りの両方を保存', both)

          // 保存失敗（DBのロック）: 理由を表示し、表示を保存済みの値へ戻す
          const release = lockDb()
          try {
            // ロック中は Main がSQLiteの待ちで止まるため、押した直後の表示はここでは確かめない（上の切り替えで確認済み）
            await c.click(control(T(41), 'task-favorite'))
            await c.waitFor(`document.querySelector('[data-testid=task-favorite-error]')`, 15000, '失敗の表示（ロックの待ち時間を含む）')
          } finally {
            release()
          }
          await c.waitFor(`${control(T(41), 'task-favorite')}.getAttribute('aria-pressed') === 'true'`, 5000, '保存済みの値へ戻す')
          const error = await c.evaluate(`document.querySelector('[data-testid=task-favorite-error]').textContent`)
          assert(error.includes('お気に入りを保存できませんでした') && dbRow(dir, T(41)).favorite === 1, '理由を表示し、DBは変えない', error)
          await c.click(`document.querySelector('[data-testid=task-favorite-error] button')`)

          // Summary で押した値は Inbox でも同じ
          await openSummary(c)
          await c.click(control(T(40), 'task-favorite'))
          await sleep(500)
          assert(dbRow(dir, T(40)).favorite === 1, 'Summary で保存')
          await openInbox(c)
          assert((await pressed(c, T(40))) === 'true', 'Inbox でも同じ値')
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ],
    [
      '紐付けアイコン（3画面）: Inbox はマイルストンへ（その行だけ・選択は保持・対象外の警告なし）、Project は別マイルストン／別プロジェクトへ、Summary は所属変更しても残る。完了済み・マイルストン0件のプロジェクトは選べない。Esc では保存しない。「…」の削除（Summary・確認なし）',
      async () => {
        const dir = join(root, 'userData-task-row-assign')
        setClock(START)
        await seedDatabase(dir, {
          projects,
          milestones,
          tasks: [
            { id: T(50), title: '紐付けA', createdAt: at(50) },
            { id: T(51), title: '紐付けB', createdAt: at(51) },
            { id: T(52), title: 'Summaryの紐付け', createdAt: at(52), dueto: '2026-11-12' },
            { id: T(53), title: 'Summaryの削除', createdAt: at(53), dueto: '2026-11-13' },
            { id: T(54), title: 'Summaryの削除2', createdAt: at(54), dueto: '2026-11-14' }
          ]
        })
        const assignOf = (id) => readDb(dir, 'SELECT project_id, milestone_id FROM tasks WHERE id = ?', id)[0]
        const openAssign = async (c, id) => {
          await c.click(control(id, 'task-assign'))
          await c.waitFor(`document.querySelector('[data-testid=assign-menu] [role=menu]')?.contains(document.activeElement)`, 3000, '紐付けメニュー')
          await sleep(150)
        }
        const choose = async (c, projectId, milestoneId) => {
          await c.click(`document.querySelector('[data-testid=assign-menu] [data-assign-project-id="${projectId}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=assign-menu] [data-assign-milestone-id="${milestoneId}"]')`, 3000, 'マイルストン')
          await sleep(150)
          await c.click(`document.querySelector('[data-testid=assign-menu] [data-assign-milestone-id="${milestoneId}"]')`)
        }
        await withApp({ label: 'task-row-assign', userDataDir: dir, extraEnv: env }, async (app) => {
          const c = app.cdp
          await waitInbox(c)
          // 2件を選択中に、A の紐付けアイコン → A だけ
          await c.click(rowOf(T(50)))
          await clickWith(c, rowOf(T(51)), MOD.meta)
          await openAssign(c, T(50))
          const menu = await c.evaluate(`[...document.querySelectorAll('[data-testid=assign-menu] [data-assign-project-id]')].map((e) => ({ id: e.dataset.assignProjectId, disabled: e.getAttribute('aria-disabled') === 'true' }))`)
          assert(!menu.some((m) => m.id === P3) && menu.find((m) => m.id === P4)?.disabled === true && menu.find((m) => m.id === P1)?.disabled === false, '完了済みは出さず、マイルストン0件は選べない（プロジェクトだけの紐付けはない）', menu)
          // Esc では保存しない
          await keyWith(c, 'Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=assign-menu]') && ${listFocused}`, 3000, 'Esc で閉じて一覧へ')
          assert(assignOf(T(50)).project_id === null, 'Esc では保存しない')
          await openAssign(c, T(50))
          await choose(c, P1, M1)
          await c.waitFor(`!${rowOf(T(50))}`, 5000, 'Inbox から外れる')
          const inboxState = await c.evaluate(`({ b: !!${rowOf(T(51))}, selected: [...document.querySelectorAll('[data-testid=task-list] [aria-selected=true]')].map((e) => e.dataset.taskId), warn: !!document.querySelector('[data-testid=selected-out-of-scope], [data-testid=detail-out-of-scope]') })`)
          assert(JSON.stringify(assignOf(T(50))) === JSON.stringify({ project_id: P1, milestone_id: M1 }) && inboxState.b && JSON.stringify(inboxState.selected) === JSON.stringify([T(51)]) && !inboxState.warn, 'その行だけを紐付け（選択中の他の行は残す・対象外の警告なし）', { db: assignOf(T(50)), inboxState })

          // Project: 別のマイルストンへ（現在のマイルストンは選べない）→ 別のプロジェクトへ
          await openProject(c, P1)
          await openAssign(c, T(50))
          await c.click(`document.querySelector('[data-testid=assign-menu] [data-assign-project-id="${P1}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=assign-menu] [data-assign-milestone-id="${M1}"]')`, 3000, 'マイルストン')
          const current = await c.evaluate(`(() => { const e = document.querySelector('[data-testid=assign-menu] [data-assign-milestone-id="${M1}"]'); return { disabled: e.getAttribute('aria-disabled'), text: e.textContent } })()`)
          assert(current.disabled === 'true' && current.text.includes('現在の所属'), '現在のマイルストンは選べない', current)
          await sleep(150)
          await c.click(`document.querySelector('[data-testid=assign-menu] [data-assign-milestone-id="${M2}"]')`)
          await c.waitFor(`document.querySelector('[data-card-list="group:${M2}"] [data-task-id="${T(50)}"]')`, 5000, '別のマイルストンのカードへ移る')
          assert(JSON.stringify(assignOf(T(50))) === JSON.stringify({ project_id: P1, milestone_id: M2 }), '単体の所属変更で保存', assignOf(T(50)))
          await openAssign(c, T(50))
          await choose(c, P2, M3)
          await c.waitFor(`!document.querySelector('[data-task-row][data-task-id="${T(50)}"]')`, 5000, '別のプロジェクトへ移ると一覧から外れる')
          assert(JSON.stringify(assignOf(T(50))) === JSON.stringify({ project_id: P2, milestone_id: M3 }) && !(await c.evaluate(`!!document.querySelector('[data-testid=selected-out-of-scope]')`)), '別のプロジェクトへ移動（対象外の警告なし）', assignOf(T(50)))

          // Summary: Inbox のタスクを紐付けても、期限の条件で残る
          await openSummary(c)
          await openAssign(c, T(52))
          await choose(c, P1, M1)
          await c.waitFor(`${control(T(52), 'task-assign')}?.title.includes('案件A / 設計')`, 5000, '所属の表示の更新')
          await sleep(300)
          const kept = await c.evaluate(`!!document.querySelector('section[data-section=todayItems] [data-task-row][data-task-id="${T(52)}"]')`)
          assert(kept && JSON.stringify(assignOf(T(52))) === JSON.stringify({ project_id: P1, milestone_id: M1 }), '所属の変更だけでは Summary から外れない', assignOf(T(52)))
          // 続けて別のマイルストンへ（単体の所属変更API）
          await openAssign(c, T(52))
          await choose(c, P1, M2)
          await c.waitFor(`${control(T(52), 'task-assign')}?.title.includes('案件A / 実装')`, 5000, '所属変更')
          assert(JSON.stringify(assignOf(T(52))) === JSON.stringify({ project_id: P1, milestone_id: M2 }), 'Summary から単体の所属変更', assignOf(T(52)))

          // 「…」は削除だけ・確認なし（Summary）。Delete キーも1件
          await c.evaluate(`(() => { window.__dialogSeen = false; new MutationObserver(() => { if (document.querySelector('[role=dialog]')) window.__dialogSeen = true }).observe(document.body, { childList: true, subtree: true }) })()`)
          await c.click(control(T(53), 'task-row-menu-button'))
          await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')?.contains(document.activeElement)`, 3000, '「…」')
          const items = await c.evaluate(`[...document.querySelectorAll('[data-testid=task-row-menu] [role=menuitem]')].map((e) => e.textContent)`)
          assert(JSON.stringify(items) === JSON.stringify(['削除']), '「…」は削除だけ', items)
          await c.click(`document.querySelector('[data-testid=task-row-menu-delete]')`)
          await c.waitFor(`!document.querySelector('[data-task-row][data-task-id="${T(53)}"]')`, 5000, '削除')
          assert(readDb(dir, 'SELECT COUNT(*) AS n FROM tasks WHERE id = ?', T(53))[0].n === 0, 'DBから削除')
          await c.focus(`section[data-section=thisWeekItems] [role=listbox]`)
          await keyWith(c, 'Home', 36)
          await keyWith(c, 'Delete', 46)
          await c.waitFor(`!document.querySelector('[data-task-row][data-task-id="${T(54)}"]')`, 5000, 'Delete で削除')
          const summaryState = await c.evaluate(`({ count: document.querySelector('[data-testid=status-center]').textContent, dialog: window.__dialogSeen, empty: document.querySelectorAll('[data-testid=summary-empty]').length })`)
          assert(summaryState.count === '1 件' && summaryState.dialog === false && summaryState.empty === 3, '確認なしで削除し、件数・「該当なし」を更新', summaryState)
          assert((await requestQuit(app))?.code === 0, '正常終了')
        })
      }
    ]
  ]
}
