// フェーズ5.4: マイルストン・Inboxからの紐付け・幅広ナビゲーションのUIシナリオ。run.mjs から呼ぶ。
// 専用の一時userData（root配下）だけを使う。準備はPreloadの用途別APIで行い、DBを直接変更するのは事前データの用意だけ。
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chooseProjectSort, goToProject, assert, clickRowShowDetail, keyWith, MOD, closeInlineCreate, createDatabaseAt, firstMilestoneId, openDatabaseReadOnly, requestQuit, sleep } from './lib.mjs'

export function milestoneScenarios({ withApp, root }) {
  const dir = join(root, 'userData-milestones')
  const bulkDir = join(root, 'userData-milestones-bulk')
  const ids = {}

  const api = (c, expression) =>
    c.evaluate(`(${expression}).then((r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data })`)
  const apiRaw = (c, expression) => c.evaluate(expression)
  const task = async (c, id) => (await api(c, 'window.gtd.tasks.list()')).find((t) => t.id === id)
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
    await sleep(300)
  }
  const listIds = (c) => c.evaluate(`[...document.querySelectorAll('[data-testid=task-list] [role=option]')].map((e) => e.dataset.taskId)`)
  // フェーズ5.5: カード（表示順）ごとのキーと、描画中のタスクID（表示位置の順）
  const cardRows = (c) =>
    c.evaluate(`[...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => ({
      key: e.dataset.cardKey,
      label: e.querySelector('[data-testid=group-label]')?.textContent ?? null,
      tasks: [...e.querySelectorAll('[role=option]')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((o) => o.dataset.taskId)
    }))`)
  const newTask = async (c, milestoneId, title) => {
    const sel = `[data-testid="new-task-${milestoneId}"]`
    await c.click(`document.querySelector('${sel} button')`)
    await c.waitFor(`document.activeElement === document.querySelector('${sel} input')`, 3000, 'NEW TASK の入力欄')
    await c.insertText(title)
    await c.enter()
  }
  const menuItems = (c) =>
    c.evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].map((e) => ({ text: e.textContent, project: e.dataset.assignProjectId ?? null, milestone: e.dataset.assignMilestoneId ?? null, focused: document.activeElement === e }))`)
  const clickAssign = (c, taskId) => c.click(`document.querySelector('[data-assign-task-id="${taskId}"]')`)

  return [
    [
      'ナビゲーション: 旧アクティビティバーと独立したサイドバーはなく、1つの幅広ペインに Inbox / Project / 設定。旧 sidebarWidth を幅として読み替える',
      async () => {
        // 旧設定（sidebarWidth = 300）を持つDBを用意する（設定の書き換え・リセットをしないことの確認）
        const db = await createDatabaseAt(join(dir, 'gtd.sqlite'))
        const workspace = JSON.stringify({ version: 1, sidebarWidth: 300, detailWidth: 300, detailVisible: true, lastRoute: '/inbox' })
        db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run('workspace', workspace, '2026-11-10T00:00:00.000Z')
        db.close()
        await withApp({ label: 'navigation', userDataDir: dir }, async (app) => {
          const c = app.cdp
          const layout = await c.evaluate(`({
            activityBar: !!document.querySelector('nav[aria-label="アクティビティバー"]'),
            navs: [...document.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label')),
            items: [...document.querySelectorAll('nav[aria-label="ナビゲーション"] button[aria-label]')].map((b) => b.getAttribute('aria-label')),
            hasProjectList: !!document.querySelector('nav[aria-label="ナビゲーション"] [data-testid=new-project]'),
            width: Math.round(document.querySelector('nav[aria-label="ナビゲーション"]').getBoundingClientRect().width),
            separators: [...document.querySelectorAll('[role=separator]')].map((s) => s.getAttribute('aria-label')),
            asides: document.querySelectorAll('aside').length
          })`)
          assert(!layout.activityBar && JSON.stringify(layout.navs) === JSON.stringify(['ナビゲーション']), '旧アクティビティバーはなく、ナビゲーションは1つ', layout)
          assert(['Inbox', 'Project', '設定'].every((label) => layout.items.includes(label)) && layout.hasProjectList, 'Inbox / Project（NEW PROJECT）/ 設定', layout)
          assert(Math.abs(layout.width - 300) <= 2, '旧 sidebarWidth（300px）をナビゲーションの幅として使う', layout)
          assert(layout.separators.length === 2 && layout.separators[0].startsWith('ナビゲーションの幅を調整'), '境界線はナビゲーションと詳細パネルの2つだけ', layout)
          assert(layout.asides === 1, '独立したサイドバー領域は残っていない（aside は詳細パネルだけ）', layout)
          const saved = await api(c, 'window.gtd.workspace.get()')
          assert(saved.sidebarWidth === 300 && saved.detailVisible === true, '既存の設定を書き換えない', saved)

          // プロジェクトを登録して選択 → 折りたたんでも選択中が分かる
          await c.click(`document.querySelector('[data-testid=new-project]')`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=project-name-editor] input')`, 3000, '新規プロジェクトの名前欄')
          await c.insertText('ナビ確認')
          await c.enter()
          await c.waitFor(`/^#\\/projects\\/[0-9a-f-]{36}$/.test(location.hash)`, 5000, '登録したプロジェクトを開く')
          const selected = await c.evaluate(`document.querySelector('[data-testid=project-list] [aria-current=page]')?.textContent`)
          assert(selected?.includes('ナビ確認'), 'ナビゲーションで選択中を示す', selected)
          await c.click(`document.querySelector('button[aria-label="プロジェクト一覧を折りたたむ"]')`)
          const collapsed = await c.evaluate(`({ list: !!document.querySelector('[data-testid=project-list]'), selected: document.querySelector('[data-testid=nav-selected-project]')?.textContent })`)
          assert(!collapsed.list && collapsed.selected?.includes('ナビ確認'), '折りたたんでも選択中のプロジェクト名を表示', collapsed)
          await c.click(`document.querySelector('button[aria-label="プロジェクト一覧を表示"]')`)
          await c.waitFor(`document.querySelector('[data-testid=project-list]')`, 3000, '展開')
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
      }
    ],
    [
      'Inboxから紐付け: 行のボタン → プロジェクト → マイルストン で1回だけ保存し、Inboxから消える。キャンセル・キーボード（M）・同名の判別・失敗時は行を残す。プロジェクトだけの紐付けはなく、マイルストン0件のプロジェクトは選べない（5.6）',
      () =>
        withApp({ label: 'assign', userDataDir: dir }, async (app) => {
          const c = app.cdp
          ids.p = (await api(c, `window.gtd.projects.create({ name: '仕事' })`)).id
          ids.p2 = (await api(c, `window.gtd.projects.create({ name: '仕事' })`)).id
          ids.home = (await api(c, `window.gtd.projects.create({ name: '家' })`)).id
          // 5.6: プロジェクトには作成時の「新しいマイルストン」がある。マイルストン0件のプロジェクトも用意する（初期マイルストンを削除）
          ids.pInitial = await firstMilestoneId(c, ids.p)
          ids.homeInitial = await firstMilestoneId(c, ids.home)
          ids.empty = (await api(c, `window.gtd.projects.create({ name: 'マイルストンなし' })`)).id
          await api(c, `window.gtd.milestones.delete({ id: ${JSON.stringify(await firstMilestoneId(c, ids.empty))}, expectedTaskCount: 0 })`)
          ids.m1 = (await api(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(ids.p)}, name: 'M1' })`)).id
          ids.m2 = (await api(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(ids.p)}, name: 'M2' })`)).id
          for (const name of ['t1', 't2', 't3']) ids[name] = (await api(c, `window.gtd.tasks.create({ title: '${name}' })`)).id
          await reload(c)
          await openInbox(c)
          assert((await listIds(c)).length === 3, 'Inboxに3件')
          const navNames = await c.evaluate(`[${JSON.stringify(ids.p)}, ${JSON.stringify(ids.p2)}].map((id) => document.querySelector('[data-testid=project-list] [data-project-id="' + id + '"]').textContent)`)
          assert(navNames[0] !== navNames[1] && navNames.every((text) => text.includes('ID ')), 'ナビゲーションでも同名のプロジェクトを判別できる', navNames)
          writeFileSync(join(root, 'inbox-assign.png'), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))

          // キャンセル: プロジェクトを選んだ後で Esc → 保存しない
          await clickAssign(c, ids.t1)
          await c.waitFor(`document.querySelector('[role=menu]')`, 3000, 'メニュー')
          const step1 = await menuItems(c)
          const workLabels = step1.filter((item) => item.project === ids.p || item.project === ids.p2).map((item) => item.text)
          assert(workLabels.length === 2 && workLabels[0] !== workLabels[1] && workLabels.every((t) => t.includes('ID ')), '同名のプロジェクトを判別できる', workLabels)
          const emptyItem = await c.evaluate(`(() => { const e = document.querySelector('[role=menu] [data-assign-project-id="${ids.empty}"]'); return e ? { disabled: e.getAttribute('aria-disabled'), text: e.textContent } : null })()`)
          assert(emptyItem?.disabled === 'true' && emptyItem.text.includes('マイルストンなし'), 'マイルストン0件のプロジェクトは選べない（理由を表示）', emptyItem)
          await c.click(`document.querySelector('[role=menu] [data-assign-project-id="${ids.p}"]')`)
          await sleep(200)
          const step2 = await menuItems(c)
          assert(
            !step2.some((item) => item.text.includes('このプロジェクトに紐付け') || item.milestone === '') &&
              JSON.stringify(step2.filter((item) => item.milestone).map((item) => item.milestone)) === JSON.stringify([ids.pInitial, ids.m1, ids.m2]),
            'プロジェクトを選ぶとマイルストン（作成順）だけが出る。「このプロジェクトに紐付け」はない（まだ保存しない）',
            step2
          )
          assert((await task(c, ids.t1)).projectId === null && (await listIds(c)).includes(ids.t1), 'プロジェクトを選んだだけでは保存しない')
          await c.key('Escape', 27)
          await c.waitFor(`!document.querySelector('[role=menu]')`, 3000, 'メニューを閉じる')
          assert((await task(c, ids.t1)).projectId === null && (await listIds(c)).length === 3, 'キャンセルなら保存しない')

          // マウス: P → M2
          await clickAssign(c, ids.t1)
          await c.waitFor(`document.querySelector('[role=menu]')`, 3000, 'メニュー（2回目）')
          await c.click(`document.querySelector('[role=menu] [data-assign-project-id="${ids.p}"]')`)
          await c.click(`document.querySelector('[role=menu] [data-assign-milestone-id="${ids.m2}"]')`)
          await c.waitFor(`!document.querySelector('[data-testid=task-list] [data-task-id="${ids.t1}"]')`, 5000, 'Inboxから消える')
          const t1 = await task(c, ids.t1)
          assert(t1.projectId === ids.p && t1.milestoneId === ids.m2, 'プロジェクトとマイルストンを1回で保存', t1)

          // キーボード: 一覧で M → 先頭のプロジェクト（Enter）→ 先頭のマイルストン（Enter）
          await c.focus('[data-testid=task-list]')
          await c.key('Home', 36)
          const activeBefore = await c.evaluate(`document.getElementById(document.querySelector('[data-testid=task-list]').getAttribute('aria-activedescendant'))?.dataset.taskId`)
          await c.key('m', 77, { code: 'KeyM', text: 'm' })
          await c.waitFor(`document.querySelector('[role=menu]')`, 3000, 'Mでメニュー')
          const focused1 = (await menuItems(c)).find((item) => item.focused)
          assert(focused1?.project, 'メニューの先頭のプロジェクトにフォーカス', await menuItems(c))
          await c.key('Enter', 13, { text: '\r' })
          await sleep(300)
          const focused2 = (await menuItems(c)).find((item) => item.focused)
          assert(focused2?.milestone, '次の段階の先頭（マイルストン）にフォーカス', await menuItems(c))
          await c.key('Enter', 13, { text: '\r' })
          await c.waitFor(`!document.querySelector('[data-testid=task-list] [data-task-id="${activeBefore}"]')`, 5000, 'キーボードで紐付け')
          const byKey = await task(c, activeBefore)
          assert(byKey.projectId === focused1.project && byKey.milestoneId === focused2.milestone, 'プロジェクトのマイルストンに紐付け', byKey)
          ids.keyTask = activeBefore

          // 失敗: メニューを開いた後で「家」を完了（API。メニューを開く時は一覧を取り直すため、開いた後で変える）
          // → 家へ紐付け → Mainが拒否し、行を残して理由を表示
          const remaining = (await listIds(c))[0]
          await clickAssign(c, remaining)
          await c.waitFor(`document.querySelector('[role=menu] [data-assign-project-id="${ids.home}"]')`, 3000, 'メニュー（失敗）')
          await sleep(300)
          await api(c, `window.gtd.projects.setCompleted({ id: ${JSON.stringify(ids.home)}, completed: true })`)
          await c.click(`document.querySelector('[role=menu] [data-assign-project-id="${ids.home}"]')`)
          await c.click(`document.querySelector('[role=menu] [data-assign-milestone-id="${ids.homeInitial}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=assign-error]')`, 5000, '失敗の表示')
          const error = await c.evaluate(`document.querySelector('[data-testid=assign-error]').textContent`)
          assert(error.includes('完了済み'), '理由を表示', error)
          assert((await listIds(c)).includes(remaining) && (await task(c, remaining)).projectId === null, '失敗時は行を残す')
          ids.t3 = remaining
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      'プロジェクト画面: マイルストン別のカード（空を含む。未設定のカードはない）、カードからの追加、NEW MILESTONE・見出しからの名前変更、共通の検索、詳細から所属変更、カード内のキーボード移動',
      () =>
        // 最後に、回答を指定しない終了ダイアログで中断させる（回答漏れの記録は想定どおり）
        withApp({ label: 'groups', userDataDir: dir, expectDialogFailure: true }, async (app) => {
          const c = app.cdp
          // キーボードで紐付けた先（先頭のプロジェクト）は同名の並びに依存するため、ここで「仕事（P）の初期マイルストン」に揃える
          await api(c, `window.gtd.tasks.setAssignment({ id: ${JSON.stringify(ids.keyTask)}, projectId: ${JSON.stringify(ids.p)}, milestoneId: ${JSON.stringify(ids.pInitial)} })`)
          await reload(c)
          await openProject(c, ids.p)
          const keyOf = (id) => `group:${id}`
          let cards = await cardRows(c)
          assert(
            JSON.stringify(cards.map((x) => [x.key, x.tasks])) ===
              JSON.stringify([[keyOf(ids.pInitial), [ids.keyTask]], [keyOf(ids.m1), []], [keyOf(ids.m2), [ids.t1]]]) &&
              cards[0].label === '新しいマイルストン',
            'マイルストンの作成順（作成時の「新しいマイルストン」が先頭）、空のM1も表示、未設定のカードはない',
            cards
          )

          // NEW MILESTONE → 空のカードが増える。そのカードから追加
          await c.click(`document.querySelector('[data-testid=new-milestone-button]')`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=new-milestone] input')`, 3000, 'NEW MILESTONE の入力欄')
          await c.insertText('M3')
          await c.enter()
          await c.waitFor(`[...document.querySelectorAll('[data-testid=group-label]')].some((e) => e.textContent === 'M3')`, 5000, 'M3のカード')
          ids.m3 = (await api(c, 'window.gtd.milestones.list()')).find((m) => m.name === 'M3').id
          await newTask(c, ids.m3, 'M3のタスク')
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.some((t) => t.title === 'M3のタスク'))()`, 5000, 'M3に追加')
          const m3Task = (await api(c, 'window.gtd.tasks.list()')).find((t) => t.title === 'M3のタスク')
          assert(m3Task.projectId === ids.p && m3Task.milestoneId === ids.m3, 'projectId と milestoneId を明示して保存', m3Task)
          await closeInlineCreate(c, `new-task-${ids.m3}`)
          await newTask(c, ids.pInitial, '初期のタスク')
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.some((t) => t.title === '初期のタスク'))()`, 5000, '初期マイルストンに追加')
          const initialTask = (await api(c, 'window.gtd.tasks.list()')).find((t) => t.title === '初期のタスク')
          assert(initialTask.projectId === ids.p && initialTask.milestoneId === ids.pInitial, '初期マイルストンのカードからは、そのマイルストンに所属', initialTask)
          await closeInlineCreate(c, `new-task-${ids.pInitial}`)

          // 目視確認用のスクリーンショット（一時ディレクトリ。--keep で残る）
          writeFileSync(join(root, 'project-groups.png'), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))

          // 検索は全カードに共通（空になったカードも表示）
          await c.setInput('input[aria-label="タイトルで絞り込み"]', 'M3')
          await sleep(300)
          cards = await cardRows(c)
          assert(cards.flatMap((x) => x.tasks).join() === m3Task.id && cards.length === 4, '検索は全カードに共通・空のカードも残す', cards)
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '')
          await sleep(300)

          // キーボード: 初期マイルストンのカードの一覧の中を ↓ で順に移動
          const order = (await cardRows(c)).find((x) => x.key === keyOf(ids.pInitial)).tasks
          await c.focus(`[data-card-list="${keyOf(ids.pInitial)}"]`)
          await c.key('Home', 36)
          const activeIds = []
          for (let i = 0; i < order.length; i++) {
            activeIds.push(await c.evaluate(`document.getElementById(document.activeElement.getAttribute('aria-activedescendant'))?.dataset.taskId`))
            await c.key('ArrowDown', 40)
          }
          assert(JSON.stringify(activeIds) === JSON.stringify(order), '↓でカード内のタスク行を順に移動', { activeIds, order })

          // マイルストン名の変更（カードの見出しの「名前を変更」→ 見出しの位置の編集欄）
          await c.click(`document.querySelector('[data-rename-milestone="${ids.m1}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=milestone-name-editor] input')`, 3000, '名前の編集欄')
          await c.setInput('[data-testid=milestone-name-editor] input', 'M1（改）')
          await c.focus('[data-testid=milestone-name-editor] input')
          await c.enter()
          await c.waitFor(`[...document.querySelectorAll('[data-testid=group-label]')].some((e) => e.textContent === 'M1（改）')`, 5000, '見出しの更新')
          assert(!(await c.evaluate(`!!document.querySelector('[data-testid=milestone-name-editor]')`)), '保存後に編集欄を閉じる')

          // マイルストン名の編集中に画面遷移 → 既存の確認（文言はマイルストン名）。キャンセルで留まる
          await c.click(`document.querySelector('[data-rename-milestone="${ids.m2}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=milestone-name-editor] input')`, 3000, '名前の編集欄（M2）')
          await c.setInput('[data-testid=milestone-name-editor] input', 'M2（未保存）')
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
          await c.waitFor(`document.querySelector('[role=dialog]')?.innerText.includes('マイルストン名の変更を保存しますか')`, 3000, 'マイルストン名の確認')
          await c.click(c.byText('[role=dialog] button', 'キャンセル'))
          await sleep(300)
          assert((await c.evaluate('location.hash')) === `#/projects/${ids.p}`, 'キャンセルなら移動しない')
          assert((await c.evaluate(`document.querySelector('[data-testid=milestone-name-editor] input')?.value`)) === 'M2（未保存）', '入力を保持')
          await c.click(c.byText('[data-testid=milestone-name-editor] button', '取り消す'))

          // 詳細パネルから所属変更（初期マイルストン → M1）。タイトルのドラフトは残る
          await c.click(`document.querySelector('[data-testid=task-list] [data-task-id="${initialTask.id}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, '詳細')
          await c.setInput('[data-testid=task-editor] input:not([type=hidden])', '初期のタスク（ドラフト）')
          await c.evaluate(`(() => { const s = document.querySelector('[data-testid=task-project-select]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(`${ids.p}:${ids.m1}`)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.find((t) => t.id === ${JSON.stringify(initialTask.id)}).milestoneId === ${JSON.stringify(ids.m1)})()`, 5000, '詳細から所属変更')
          await sleep(300)
          cards = await cardRows(c)
          assert(cards.find((x) => x.key === keyOf(ids.m1)).tasks.includes(initialTask.id), 'M1のカードへ移る', cards)
          assert((await c.evaluate(`document.querySelector('[data-testid=task-editor] input:not([type=hidden])').value`)) === '初期のタスク（ドラフト）', 'タイトルのドラフトを保持')
          assert((await task(c, initialTask.id)).title === '初期のタスク', 'ドラフトは保存されていない')
          await c.click(c.byText('[data-testid=task-editor] button', '変更を取り消す'))

          // 完了済みプロジェクト: NEW MILESTONE・NEW TASK は無効
          await api(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(ids.p2)}, name: 'P2のM' })`)
          await api(c, `window.gtd.projects.setCompleted({ id: ${JSON.stringify(ids.p2)}, completed: true })`)
          await reload(c)
          await openProject(c, ids.p2)
          const completed = await c.evaluate(`({ milestone: document.querySelector('[data-testid=new-milestone-button]').disabled, add: [...document.querySelectorAll('[data-testid^=new-task-][data-testid$=-button]')].map((b) => b.disabled) })`)
          assert(completed.milestone && completed.add.length === 2 && completed.add.every(Boolean), '完了済みプロジェクトでは追加を無効にする', completed)
          const conflict = await apiRaw(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(ids.p2)}, name: 'x' })`)
          assert(!conflict.ok && conflict.error.code === 'CONFLICT', 'Main側でも拒否', conflict)
          await openProject(c, ids.p)
          await c.click(`document.querySelector('[data-rename-milestone="${ids.m2}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=milestone-name-editor] input')`, 3000, '名前の編集欄（終了用）')
          await c.setInput('[data-testid=milestone-name-editor] input', 'M2（終了前の編集）')
          const quit = await requestQuit(app, 8000)
          // 回答を指定していないので、終了ダイアログ（マイルストン名）で中断される
          assert(quit === null, '未保存のマイルストン名があれば終了前に確認する（回答なしはキャンセル扱い）', quit)
          assert(app.logs.some((line) => line.includes('マイルストン名に未保存の変更があります')), '終了時のダイアログはマイルストン名の文言（共通のダイアログ）', app.logs.filter((l) => l.includes('dialog')))
        })
    ],
    [
      '終了: マイルストン名の編集中 →（指定した回答）保存して終了',
      () =>
        withApp(
          { label: 'milestone-exit', userDataDir: dir, dialogAnswers: [{ message: 'マイルストン名に未保存の変更があります', button: '保存して終了' }] },
          async (app) => {
            const c = app.cdp
            await openProject(c, ids.p)
            await c.waitFor(`document.querySelector('[data-rename-milestone="${ids.m2}"]')`, 5000, 'マイルストンの見出し')
            await c.click(`document.querySelector('[data-rename-milestone="${ids.m2}"]')`)
            await c.waitFor(`document.querySelector('[data-testid=milestone-name-editor] input')`, 3000, '名前の編集欄')
            await c.setInput('[data-testid=milestone-name-editor] input', 'M2（保存して終了）')
            const quit = await requestQuit(app)
            assert(quit?.code === 0, '保存して終了', quit)
            const db = openDatabaseReadOnly(join(dir, 'gtd.sqlite'))
            try {
              assert(db.prepare('SELECT name FROM milestones WHERE id = ?').get(ids.m2).name === 'M2（保存して終了）', 'マイルストン名を保存')
            } finally {
              db.close()
            }
          }
        )
    ],
    [
      '大量データ（3,000件・マイルストン6つ）: カードごとの仮想化、検索・状態・ソートの共通適用、カード内の末尾への移動',
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
          for (let i = 0; i < 3000; i++) {
            const id = randomUUID()
            const milestoneId = milestoneIds[i % 6]
            const at = new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString()
            // 6件ごとに全グループへ1件ずつ配る。状態・題名は6件単位で変え、どのグループにも全組み合わせができるようにする
            const k = Math.floor(i / 6)
            const completedAt = k % 3 === 0 ? at : null
            const title = `${k % 2 === 0 ? '報告' : '連絡'} ${i}`
            insert.run(id, title, at, at, completedAt, projectId, milestoneId)
            rows.push({ id, title, createdAt: at, completedAt, milestoneId })
          }
        })()
        db.close()
        await withApp({ label: 'milestones-bulk', userDataDir: bulkDir }, async (app) => {
          const c = app.cdp
          await openProject(c, projectId)
          await c.waitFor(`document.querySelectorAll('[data-testid=task-list] [role=option]').length > 0`, 10000, '一覧')
          await c.waitFor(`[...document.querySelectorAll('[data-testid=milestone-card]')].length === 6 && [...document.querySelectorAll('[data-testid=milestone-card]')].every((e) => e.querySelector('[role=option]'))`, 10000, 'すべてのカードの描画（カードごとの仮想リストは別々に測定される）')
          await sleep(200)
          const open = rows.filter((r) => r.completedAt === null)
          assert((await c.evaluate(`document.querySelector('[data-testid=task-count]').textContent`)) === `${open.length} 件表示 / 全 3000 件`, '件数')
          let cards = await cardRows(c)
          assert(cards.length === 6 && cards[0].key === `group:${milestoneIds[0]}` && cards.every((x) => x.tasks.length > 0 && x.tasks.length < 60), 'カードごとに一部だけ描画・先頭はM1', cards.map((x) => [x.key, x.tasks.length]))
          // フェーズ5.9: プロジェクトの既定の並べ替えは手動順（手動順がなければ作成日時の古い順）
          const firstOfM1 = open.filter((r) => r.milestoneId === milestoneIds[0]).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0]
          assert(cards[0].tasks[0] === firstOfM1.id, 'M1の中は作成日時の古い順（手動順なし）', cards[0].tasks.slice(0, 3))
          // 検索 × 状態（完了）× タイトル順 → 最後のカード（M6）の End は、その中の最後のタスク
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '報告')
          await c.click(c.byText('button', '完了'))
          await chooseProjectSort(c, 'title')
          await sleep(200)
          const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })
          const filtered = rows.filter((r) => r.completedAt !== null && r.title.includes('報告'))
          assert((await c.evaluate(`document.querySelector('[data-testid=task-count]').textContent`)) === `${filtered.length} 件表示 / 全 3000 件`, '組み合わせた件数')
          const lastCardSorted = filtered.filter((r) => r.milestoneId === milestoneIds[5]).sort((a, b) => collator.compare(a.title, b.title))
          cards = await cardRows(c)
          assert(cards.at(-1).tasks[0] === lastCardSorted[0].id, '最後のカードの先頭はタイトル順の最初', cards.at(-1).tasks.slice(0, 3))
          await c.focus(`[data-card-list="group:${milestoneIds[5]}"]`)
          await c.key('End', 35)
          await sleep(400)
          cards = await cardRows(c)
          const active = await c.evaluate(`document.getElementById(document.activeElement.getAttribute('aria-activedescendant'))?.dataset.taskId`)
          const lastOfLastCard = lastCardSorted.at(-1)
          assert(active === lastOfLastCard.id && cards.at(-1).tasks.at(-1) === lastOfLastCard.id && cards.at(-1).tasks.length < 60, 'End でカードの最後の行へ移動（描画は一部）', { active, last: cards.at(-1).tasks.at(-1) })
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
      }
    ]
  ]
}
