// フェーズ5.4: マイルストン・Inboxからの紐付け・幅広ナビゲーションのUIシナリオ。run.mjs から呼ぶ。
// 専用の一時userData（root配下）だけを使う。準備はPreloadの用途別APIで行い、DBを直接変更するのは事前データの用意だけ。
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, createDatabaseAt, openDatabaseReadOnly, requestQuit, sleep } from './lib.mjs'

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
    await c.click(`document.querySelector('[data-testid=project-list] [data-project-id="${projectId}"]')`)
    await c.waitFor(`location.hash === ${JSON.stringify(`#/projects/${projectId}`)}`, 5000, 'プロジェクトを開く')
    await sleep(300)
  }
  const listIds = (c) => c.evaluate(`[...document.querySelectorAll('[data-testid=task-list] [role=option]')].map((e) => e.dataset.taskId)`)
  // 表示位置の順に並べた行（見出しは "H:<key>"、タスクは "T:<id>"）
  const visualRows = (c) =>
    c.evaluate(`(() => {
      const rows = [
        ...[...document.querySelectorAll('[data-testid=task-list-overlay] [data-group-key]')].map((e) => ({ top: e.getBoundingClientRect().top, id: 'H:' + e.dataset.groupKey })),
        ...[...document.querySelectorAll('[data-testid=task-list] [role=option]')].map((e) => ({ top: e.getBoundingClientRect().top, id: 'T:' + e.dataset.taskId }))
      ]
      return rows.sort((a, b) => a.top - b.top).map((r) => r.id)
    })()`)
  const menuItems = (c) =>
    c.evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].map((e) => ({ text: e.textContent, project: e.dataset.assignProjectId ?? null, milestone: e.dataset.assignMilestoneId ?? null, focused: document.activeElement === e }))`)
  const clickAssign = (c, taskId) => c.click(`document.querySelector('[data-assign-task-id="${taskId}"]')`)

  return [
    [
      'ナビゲーション: 旧アクティビティバーと独立したサイドバーはなく、1つの幅広ペインに Inbox / Projects / 設定。旧 sidebarWidth を幅として読み替える',
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
            hasProjectList: !!document.querySelector('nav[aria-label="ナビゲーション"] [data-testid=project-list], nav[aria-label="ナビゲーション"] input[aria-label="新しいプロジェクトの名前"]'),
            width: Math.round(document.querySelector('nav[aria-label="ナビゲーション"]').getBoundingClientRect().width),
            separators: [...document.querySelectorAll('[role=separator]')].map((s) => s.getAttribute('aria-label')),
            asides: document.querySelectorAll('aside').length
          })`)
          assert(!layout.activityBar && JSON.stringify(layout.navs) === JSON.stringify(['ナビゲーション']), '旧アクティビティバーはなく、ナビゲーションは1つ', layout)
          assert(['Inbox', 'Projects', '設定'].every((label) => layout.items.includes(label)) && layout.hasProjectList, 'Inbox / Projects（登録欄）/ 設定', layout)
          assert(Math.abs(layout.width - 300) <= 2, '旧 sidebarWidth（300px）をナビゲーションの幅として使う', layout)
          assert(layout.separators.length === 2 && layout.separators[0].startsWith('ナビゲーションの幅を調整'), '境界線はナビゲーションと詳細パネルの2つだけ', layout)
          assert(layout.asides === 1, '独立したサイドバー領域は残っていない（aside は詳細パネルだけ）', layout)
          const saved = await api(c, 'window.gtd.workspace.get()')
          assert(saved.sidebarWidth === 300 && saved.detailVisible === true, '既存の設定を書き換えない', saved)

          // プロジェクトを登録して選択 → 折りたたんでも選択中が分かる
          await c.focus('input[aria-label="新しいプロジェクトの名前"]')
          await c.insertText('ナビ確認')
          await c.enter()
          await c.waitFor(`location.hash.startsWith('#/projects/')`, 5000, '登録したプロジェクトを開く')
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
      'Inboxから紐付け: 行のボタン → プロジェクト → マイルストン で1回だけ保存し、Inboxから消える。キャンセル・キーボード（M）・同名の判別・失敗時は行を残す',
      () =>
        withApp({ label: 'assign', userDataDir: dir }, async (app) => {
          const c = app.cdp
          ids.p = (await api(c, `window.gtd.projects.create({ name: '仕事' })`)).id
          ids.p2 = (await api(c, `window.gtd.projects.create({ name: '仕事' })`)).id
          ids.home = (await api(c, `window.gtd.projects.create({ name: '家' })`)).id
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
          await c.click(`document.querySelector('[role=menu] [data-assign-project-id="${ids.p}"]')`)
          await sleep(200)
          const step2 = await menuItems(c)
          assert(step2.some((item) => item.text.includes('このプロジェクトに紐付け')) && step2.some((item) => item.milestone === ids.m1) && step2.some((item) => item.milestone === ids.m2), 'プロジェクトを選ぶと「このプロジェクトに紐付け」とマイルストンが出る（まだ保存しない）', step2)
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

          // キーボード: 一覧で M → 先頭のプロジェクト（Enter）→「このプロジェクトに紐付け」（Enter）
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
          assert(focused2?.text.includes('このプロジェクトに紐付け'), '次の段階の先頭にフォーカス', await menuItems(c))
          await c.key('Enter', 13, { text: '\r' })
          await c.waitFor(`!document.querySelector('[data-testid=task-list] [data-task-id="${activeBefore}"]')`, 5000, 'キーボードで紐付け')
          const byKey = await task(c, activeBefore)
          assert(byKey.projectId === focused1.project && byKey.milestoneId === null, 'プロジェクトだけに紐付け（マイルストン未設定）', byKey)
          ids.keyTask = activeBefore

          // 失敗: メニューを開いた後で「家」を完了（API。メニューを開く時は一覧を取り直すため、開いた後で変える）
          // → 家へ紐付け → Mainが拒否し、行を残して理由を表示
          const remaining = (await listIds(c))[0]
          await clickAssign(c, remaining)
          await c.waitFor(`document.querySelector('[role=menu] [data-assign-project-id="${ids.home}"]')`, 3000, 'メニュー（失敗）')
          await sleep(300)
          await api(c, `window.gtd.projects.setCompleted({ id: ${JSON.stringify(ids.home)}, completed: true })`)
          await c.click(`document.querySelector('[role=menu] [data-assign-project-id="${ids.home}"]')`)
          await c.click(`document.querySelector('[role=menu] [data-assign-milestone-id=""]')`)
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
      'プロジェクト画面: マイルストン別のグループ（空・未設定を含む）、グループからの追加、マイルストン登録・名前変更、共通の検索・状態、詳細から所属変更、キーボード移動',
      () =>
        // 最後に、回答を指定しない終了ダイアログで中断させる（回答漏れの記録は想定どおり）
        withApp({ label: 'groups', userDataDir: dir, expectDialogFailure: true }, async (app) => {
          const c = app.cdp
          // キーボードで紐付けた先（先頭のプロジェクト）は同名の並びに依存するため、ここで「仕事（P）の未設定」に揃える
          await api(c, `window.gtd.tasks.setAssignment({ id: ${JSON.stringify(ids.keyTask)}, projectId: ${JSON.stringify(ids.p)}, milestoneId: null })`)
          await reload(c)
          await openProject(c, ids.p)
          const keyOf = (id) => (id === null ? 'group:unset' : `group:${id}`)
          let rows = await visualRows(c)
          const t2 = (await api(c, 'window.gtd.tasks.list()')).find((t) => t.projectId === ids.p && t.milestoneId === null)
          assert(
            JSON.stringify(rows) === JSON.stringify([`H:${keyOf(ids.m1)}`, `H:${keyOf(ids.m2)}`, `T:${ids.t1}`, `H:${keyOf(null)}`, `T:${t2.id}`]),
            'マイルストンの作成順、空のM1も表示、最後に未設定',
            rows
          )

          // マイルストン登録 → 空のグループが増える。そのグループから追加
          await c.focus('input[aria-label="新しいマイルストンの名前"]')
          await c.insertText('M3')
          await c.enter()
          await c.waitFor(`[...document.querySelectorAll('[data-testid=group-label]')].some((e) => e.textContent === 'M3')`, 5000, 'M3のグループ')
          ids.m3 = (await api(c, 'window.gtd.milestones.list()')).find((m) => m.name === 'M3').id
          await c.click(`document.querySelector('[data-add-group="${ids.m3}"]')`)
          await sleep(200)
          const target = await c.evaluate(`({ text: document.querySelector('[data-testid=task-add-target]').textContent, focused: document.activeElement === document.querySelector('input[aria-label="タスクのタイトル"]') })`)
          assert(target.text === '「仕事」 › M3に追加' && target.focused, '追加先をM3に切り替えて入力欄へフォーカス', target)
          await c.insertText('M3のタスク')
          await c.enter()
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.some((t) => t.title === 'M3のタスク'))()`, 5000, 'M3に追加')
          const m3Task = (await api(c, 'window.gtd.tasks.list()')).find((t) => t.title === 'M3のタスク')
          assert(m3Task.projectId === ids.p && m3Task.milestoneId === ids.m3, 'projectId と milestoneId を明示して保存', m3Task)
          // 追加した行が描画されて見出しの位置が確定してから押し、追加先の表示が切り替わったことを確かめてから入力する
          await c.waitFor(`document.querySelector('[data-testid=task-list] [data-task-id="${m3Task.id}"]')`, 5000, '追加した行の描画')
          await sleep(200)
          await c.click(`document.querySelector('[data-add-group=""]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-add-target]')?.textContent === '「仕事」（マイルストン未設定）に追加'`, 3000, '追加先を未設定に切り替え')
          await c.insertText('未設定のタスク')
          await c.enter()
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.some((t) => t.title === '未設定のタスク'))()`, 5000, '未設定に追加')
          const unsetTask = (await api(c, 'window.gtd.tasks.list()')).find((t) => t.title === '未設定のタスク')
          assert(unsetTask.projectId === ids.p && unsetTask.milestoneId === null, '未設定からは projectId だけ', unsetTask)

          // 目視確認用のスクリーンショット（一時ディレクトリ。--keep で残る）
          writeFileSync(join(root, 'project-groups.png'), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))

          // 検索は全グループ共通（空になったグループも表示）
          await c.setInput('input[aria-label="タイトルで絞り込み"]', 'M3')
          await sleep(300)
          rows = await visualRows(c)
          assert(rows.filter((r) => r.startsWith('T:')).join() === `T:${m3Task.id}` && rows.filter((r) => r.startsWith('H:')).length === 4, '検索は全グループに共通・空のグループも残す', rows)
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '')
          await sleep(300)

          // キーボード: 見出し行を飛ばしてタスク行だけを移動する
          await c.focus('[data-testid=task-list]')
          await c.key('Home', 36)
          const order = (await visualRows(c)).filter((r) => r.startsWith('T:')).map((r) => r.slice(2))
          const activeIds = []
          for (let i = 0; i < order.length; i++) {
            activeIds.push(await c.evaluate(`document.getElementById(document.querySelector('[data-testid=task-list]').getAttribute('aria-activedescendant'))?.dataset.taskId`))
            await c.key('ArrowDown', 40)
          }
          assert(JSON.stringify(activeIds) === JSON.stringify(order), '↓で見出しを飛ばしてタスク行を順に移動', { activeIds, order })

          // マイルストン名の変更（見出しの「名前変更」→ 一覧の外の編集欄）
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

          // 詳細パネルから所属変更（未設定 → M1）。タイトルのドラフトは残る
          await c.click(`document.querySelector('[data-testid=task-list] [data-task-id="${unsetTask.id}"]')`)
          await c.waitFor(`document.querySelector('[data-testid=task-editor]')`, 3000, '詳細')
          await c.setInput('[data-testid=task-editor] input:not([type=hidden])', '未設定のタスク（ドラフト）')
          await c.evaluate(`(() => { const s = document.querySelector('[data-testid=task-project-select]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(`${ids.p}:${ids.m1}`)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
          await c.waitFor(`(async () => (await window.gtd.tasks.list()).data.find((t) => t.id === ${JSON.stringify(unsetTask.id)}).milestoneId === ${JSON.stringify(ids.m1)})()`, 5000, '詳細から所属変更')
          await sleep(300)
          rows = await visualRows(c)
          assert(rows.indexOf(`T:${unsetTask.id}`) === rows.indexOf(`H:${keyOf(ids.m1)}`) + 1, 'M1のグループへ移る', rows)
          assert((await c.evaluate(`document.querySelector('[data-testid=task-editor] input:not([type=hidden])').value`)) === '未設定のタスク（ドラフト）', 'タイトルのドラフトを保持')
          assert((await task(c, unsetTask.id)).title === '未設定のタスク', 'ドラフトは保存されていない')
          await c.click(c.byText('[data-testid=task-editor] button', '変更を取り消す'))

          // 完了済みプロジェクト: マイルストン登録・グループからの追加は無効
          await api(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(ids.p2)}, name: 'P2のM' })`)
          await api(c, `window.gtd.projects.setCompleted({ id: ${JSON.stringify(ids.p2)}, completed: true })`)
          await reload(c)
          await openProject(c, ids.p2)
          const completed = await c.evaluate(`({ milestoneInput: document.querySelector('input[aria-label="新しいマイルストンの名前"]').disabled, add: [...document.querySelectorAll('[data-add-group]')].every((b) => b.disabled), quick: document.querySelector('input[aria-label="タスクのタイトル"]').disabled })`)
          assert(completed.milestoneInput && completed.add && completed.quick, '完了済みプロジェクトでは追加を無効にする', completed)
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
      '大量データ（3,000件・マイルストン5つ）: グループ表示の仮想化、検索・状態・ソートの共通適用、末尾への移動',
      async () => {
        const db = await createDatabaseAt(join(bulkDir, 'gtd.sqlite'))
        const projectId = randomUUID()
        db.prepare('INSERT INTO projects (id, name, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, NULL)').run(projectId, '大量', 'a', 'a')
        const milestoneIds = []
        for (let i = 0; i < 5; i++) {
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
            const milestoneId = i % 6 === 5 ? null : milestoneIds[i % 6]
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
          const open = rows.filter((r) => r.completedAt === null)
          assert((await c.evaluate(`document.querySelector('[data-testid=task-count]').textContent`)) === `${open.length} 件表示 / 全 3000 件`, '件数')
          let visual = await visualRows(c)
          assert(visual.length < 80 && visual[0] === `H:group:${milestoneIds[0]}`, '描画は一部だけ・先頭はM1の見出し', visual.slice(0, 3))
          const firstOfM1 = open.filter((r) => r.milestoneId === milestoneIds[0]).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
          assert(visual[1] === `T:${firstOfM1.id}`, 'M1の中は作成日時の降順', visual.slice(0, 3))
          // 検索 × 状態（完了）× タイトル順 → 末尾は「未設定」グループの最後のタスク
          await c.setInput('input[aria-label="タイトルで絞り込み"]', '報告')
          await c.click(c.byText('button', '完了'))
          await c.click(`document.querySelector('[aria-label^="タイトルで並べ替え"]')`)
          await sleep(400)
          const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })
          const filtered = rows.filter((r) => r.completedAt !== null && r.title.includes('報告'))
          assert((await c.evaluate(`document.querySelector('[data-testid=task-count]').textContent`)) === `${filtered.length} 件表示 / 全 3000 件`, '組み合わせた件数')
          const lastUnset = filtered.filter((r) => r.milestoneId === null).sort((a, b) => collator.compare(a.title, b.title)).at(-1)
          await c.focus('[data-testid=task-list]')
          await c.key('End', 35)
          await sleep(400)
          visual = await visualRows(c)
          const active = await c.evaluate(`document.getElementById(document.querySelector('[data-testid=task-list]').getAttribute('aria-activedescendant'))?.dataset.taskId`)
          assert(active === lastUnset.id && visual.at(-1) === `T:${lastUnset.id}` && visual.length < 80, 'End で最後のグループの最後の行へ移動（描画は一部）', { active, last: visual.at(-1) })
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
      }
    ]
  ]
}
