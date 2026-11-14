// フェーズ5.7: Inbox・Project画面のメインパネルの簡素化（タイトル行・説明行・操作説明・マイルストン0件の案内文の削除）のUIシナリオ。
// run.mjs から呼ぶ。専用の一時userData（root配下）だけを使う。準備はPreloadの用途別APIで行う。
import { join } from 'node:path'
import { goToProject, assert, clickRowShowDetail, keyWith, MOD, firstMilestoneId, requestQuit, sleep } from './lib.mjs'

export function layoutScenarios({ withApp, root }) {
  const dir = join(root, 'userData-layout')

  const api = (c, expression) =>
    c.evaluate(`(${expression}).then((r) => { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data })`)
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
  // メインパネルの見出しと、最初の表示要素の位置（見出しの行・空白が残っていないか）
  const layout = (c) =>
    c.evaluate(`(() => {
      const main = document.querySelector('main')
      const title = document.querySelector('main [data-testid=page-title]')
      const container = title.parentElement
      const pad = parseFloat(getComputedStyle(container).paddingTop)
      const first = [...container.children].find((e) => e !== title)
      const tr = title.getBoundingClientRect()
      // 読み上げ用の非表示の見出しを除いた、表示されている文字の行
      const visibleText = [...container.children].filter((e) => e !== title).map((e) => e.innerText).join('\\n')
      const lines = visibleText.split('\\n').map((l) => l.trim()).filter(Boolean)
      return {
        mainName: main.getAttribute('aria-label'),
        title: { tag: title.tagName, text: title.textContent, visible: tr.width > 1 && tr.height > 1 },
        firstOffset: Math.round(first.getBoundingClientRect().top - container.getBoundingClientRect().top - pad),
        lines,
        help: visibleText.includes('一覧の操作'),
        lists: [...document.querySelectorAll('main [role=listbox]')].map((l) => ({ name: l.getAttribute('aria-label'), describedby: l.getAttribute('aria-describedby') }))
      }
    })()`)
  const shiftF10 = async (c) => {
    await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'F10', code: 'F10', windowsVirtualKeyCode: 121, modifiers: 8 })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F10', code: 'F10', windowsVirtualKeyCode: 121, modifiers: 8 })
  }
  // カード列と NEW MILESTONE の位置
  const board = (c) =>
    c.evaluate(`(() => {
      const main = document.querySelector('main').getBoundingClientRect()
      const b = document.querySelector('[data-testid=milestone-board]')
      const br = b.getBoundingClientRect()
      const nm = document.querySelector('[data-testid=new-milestone]').getBoundingClientRect()
      const cards = [...document.querySelectorAll('[data-testid=milestone-card]')].map((e) => e.getBoundingClientRect())
      return {
        cards: cards.length,
        note: !!document.querySelector('[data-testid=no-milestone-note]') || b.innerText.includes('マイルストンがありません'),
        newMilestoneLeft: Math.round(nm.left - br.left),
        boardInset: Math.round(br.left - main.left),
        newMilestoneVisible: nm.left >= br.left - 1 && nm.right <= br.right + 1,
        afterLastCard: cards.length === 0 || nm.left >= cards.at(-1).right - 1,
        scrollLeft: b.scrollLeft,
        children: [...b.children].map((e) => e.dataset.testid ?? e.tagName)
      }
    })()`)
  const deleteEmptyMilestone = async (c, milestoneId) => {
    await c.click(`document.querySelector('[data-milestone-menu="${milestoneId}"]')`)
    await c.waitFor(`document.querySelector('[data-testid=milestone-menu] [role=menu]')`, 3000, 'カードのメニュー')
    await c.click(`document.querySelector('[data-testid=milestone-menu-delete]')`)
    await c.waitFor(`!document.querySelector('[data-card-key="group:${milestoneId}"]')`, 5000, '空のマイルストンの削除')
    await sleep(200)
  }

  return [
    [
      'メインパネルの簡素化: Inbox・Project のタイトル行・説明行・操作説明を表示せず空白も残さない（見出し・一覧の名前は維持）、プロジェクト名と編集・NEW PROJECT のフォーカス、キーボード操作と行のメニューは従来どおり',
      () =>
        withApp({ label: 'layout', userDataDir: dir }, async (app) => {
          const c = app.cdp
          await api(c, `window.gtd.tasks.create({ title: 'Inboxのタスク' })`)
          const p = (await api(c, `window.gtd.projects.create({ name: '表示確認' })`)).id
          await api(c, `window.gtd.tasks.create({ title: 'カードのタスク', projectId: ${JSON.stringify(p)}, milestoneId: ${JSON.stringify(await firstMilestoneId(c, p))} })`)
          await reload(c)

          // Inbox
          await c.click(`document.querySelector('nav button[aria-label="Inbox"]')`)
          await c.waitFor(`location.hash === '#/inbox'`, 5000, 'Inbox')
          await sleep(300)
          let l = await layout(c)
          assert(l.title.tag === 'H1' && l.title.text === 'Inbox' && !l.title.visible, 'Inboxのタイトル行は表示しない（見出しは読み上げ用に残す）', l.title)
          assert(!l.lines.includes('Inbox') && !l.lines.includes('プロジェクトに属さないタスク') && !l.help, 'タイトル・説明行・操作説明を表示しない', l.lines.slice(0, 8))
          assert(Math.abs(l.firstOffset) <= 1, '追加欄がパネルの上端（通常の余白）から始まる（空白行を残さない）', l.firstOffset)
          assert(l.mainName === 'メインパネル' && l.lists.length === 1 && l.lists[0].name?.startsWith('タスク一覧') && l.lists[0].describedby === null, 'メイン領域・一覧のアクセシブル名を維持し、削除した説明への参照を残さない', l)
          const nav = await c.evaluate(`({ inbox: !!document.querySelector('nav button[aria-label="Inbox"]'), badge: document.querySelector('[data-testid=nav-inbox-badge]')?.textContent, project: !!document.querySelector('nav button[aria-label="Project"]') })`)
          assert(nav.inbox && nav.badge === '1' && nav.project, '左サイドバーの Inbox・バッジ・Project は残る', nav)
          const controls = await c.evaluate(`({ add: !!document.querySelector('main input[aria-label="タスクのタイトル"]'), search: !!document.querySelector('input[aria-label="タイトルで絞り込み"]'), filter: !!document.querySelector('[aria-label="表示するタスク"]') })`)
          assert(controls.add && controls.search && controls.filter, '登録・検索・フィルターは残る', controls)
          // キーボード操作・行のメニュー（説明文を消しても操作は維持）
          await c.focus('[data-testid=task-list]')
          await c.key('Home', 36)
          // フェーズ5.9: Delete は確認なしで削除するため、ここでは F2（インライン編集）→ Esc で操作の維持を確かめる
          await c.key('F2', 113)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=inline-title-editor] input')`, 3000, 'F2 で名前の編集')
          await c.key('Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=inline-title-editor]')`, 3000, 'Escで閉じる')
          await c.focus('[data-testid=task-list]')
          await shiftF10(c)
          await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')`, 3000, 'Shift+F10 でメニュー')
          await c.key('Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=task-row-menu]')`, 3000, 'メニューを閉じる')
          await c.focus('[data-testid=task-list]')
          await c.key('m', 77, { code: 'KeyM', text: 'm' })
          await c.waitFor(`document.querySelector('[data-testid=assign-menu] [role=menu]')`, 3000, 'M で紐付け')
          await c.key('Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=assign-menu]')`, 3000, '紐付けを閉じる')

          // Project（個別のプロジェクト）
          await openProject(c, p)
          l = await layout(c)
          assert(l.title.text === 'Project' && !l.title.visible && !l.lines.includes('Project') && !l.help, '画面種別の「Project」の行・操作説明を表示しない', { title: l.title, lines: l.lines.slice(0, 6) })
          assert(Math.abs(l.firstOffset) <= 1, 'プロジェクト名がパネルの上端から始まる（空白行を残さない）', l.firstOffset)
          assert(l.lists.length === 1 && l.lists[0].name?.includes('新しいマイルストン') && l.lists[0].describedby === null, 'カードの一覧の名前を維持', l.lists)
          const name = await c.evaluate(`document.querySelector('[data-testid=project-name]')?.textContent`)
          assert(name === '表示確認', '個別のプロジェクト名は表示する', name)
          await c.click(`document.querySelector('button[aria-label="プロジェクト名を変更"]')`)
          await c.waitFor(`document.querySelector('[data-testid=project-name-editor] input')`, 3000, 'プロジェクト名の編集')
          await c.key('Escape', 27)
          await c.waitFor(`document.querySelector('[data-testid=project-name]')`, 3000, 'Escで編集を閉じる')
          const b = await board(c)
          assert(b.cards === 1 && b.afterLastCard, 'マイルストンがあれば NEW MILESTONE はカード列の末尾', b)
          // カードの一覧でもキーボード操作・行のメニューは従来どおり
          await c.focus(`[data-card-list^="group:"]`)
          await c.key('Home', 36)
          await shiftF10(c)
          await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')`, 3000, 'カードでも Shift+F10 でメニュー')
          await c.key('Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=task-row-menu]')`, 3000, 'メニューを閉じる')
          await c.evaluate(`document.querySelector('[data-testid=task-list] [role=option]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`)
          await c.waitFor(`document.querySelector('[data-testid=task-row-menu] [role=menu]')`, 3000, '右クリックでメニュー')
          await c.key('Escape', 27)
          await c.waitFor(`!document.querySelector('[data-testid=task-row-menu]')`, 3000, 'メニューを閉じる')

          // NEW PROJECT: 名前欄へフォーカス（タイトル行を消しても編集画面は従来どおり）
          await c.click(`document.querySelector('[data-testid=new-project]')`)
          await c.waitFor(`location.hash === '#/projects/new'`, 3000, '新規画面')
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=project-name-editor] input')`, 3000, '名前欄にフォーカス')
          l = await layout(c)
          assert(!l.title.visible && !l.lines.includes('Project') && Math.abs(l.firstOffset) <= 1, '新規画面もタイトル行・空白行なし', { title: l.title, firstOffset: l.firstOffset })
          await c.key('Escape', 27)
          await c.waitFor(`location.hash !== '#/projects/new'`, 3000, 'Escで戻る')

          // Project（未選択）
          await c.evaluate(`location.hash = '#/projects'`)
          await c.waitFor(`location.hash === '#/projects'`, 3000, '/projects')
          await sleep(300)
          l = await layout(c)
          assert(!l.title.visible && !l.lines.includes('Project') && Math.abs(l.firstOffset) <= 1, '未選択の画面もタイトル行なし', { title: l.title, lines: l.lines })
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ],
    [
      'マイルストン0件: 案内文なしで NEW MILESTONE をカード列の左端（パネルの余白の内側）に表示、作成でカード表示へ、最後のマイルストンの削除直後も先頭までスクロールして同じ表示',
      () =>
        withApp({ label: 'layout-empty', userDataDir: dir }, async (app) => {
          const c = app.cdp
          // マイルストン0件のプロジェクト（初期マイルストンを削除）
          const e = (await api(c, `window.gtd.projects.create({ name: '空のプロジェクト' })`)).id
          await api(c, `window.gtd.milestones.delete({ id: ${JSON.stringify(await firstMilestoneId(c, e))}, expectedTaskCount: 0 })`)
          // 横スクロールが必要な数のマイルストンを持つプロジェクト
          const q = (await api(c, `window.gtd.projects.create({ name: '多いプロジェクト' })`)).id
          for (let i = 2; i <= 6; i++) await api(c, `window.gtd.milestones.create({ projectId: ${JSON.stringify(q)}, name: 'M${i}' })`)
          await reload(c)

          await openProject(c, e)
          let b = await board(c)
          assert(b.cards === 0 && !b.note && b.children.length === 1, '案内文・空のカードを残さない（カード列の中は NEW MILESTONE だけ）', b)
          assert(b.newMilestoneLeft <= 1 && b.boardInset >= 16 && b.newMilestoneVisible && b.scrollLeft === 0, 'NEW MILESTONE はカード列の左端・パネルの境界には密着しない・最初から見える', b)
          const disabled = await c.evaluate(`document.querySelector('[data-testid=new-milestone-button]').disabled`)
          assert(disabled === false && !(await c.evaluate(`!!document.querySelector('[data-testid^=new-task-]')`)), 'NEW MILESTONE は使え、タスクは追加できない', disabled)
          // 作成すると通常のカード表示に切り替わる（NEW MILESTONE は末尾へ）
          await c.click(`document.querySelector('[data-testid=new-milestone-button]')`)
          await c.waitFor(`document.activeElement === document.querySelector('[data-testid=new-milestone] input')`, 3000, 'NEW MILESTONE の入力欄')
          await c.insertText('最初のM')
          await c.enter()
          await c.waitFor(`document.querySelectorAll('[data-testid=milestone-card]').length === 1`, 5000, 'カードの表示')
          b = await board(c)
          assert(b.cards === 1 && b.afterLastCard && !b.note, '作成後は通常のカード表示（NEW MILESTONE は末尾）', b)

          // 横スクロールした状態から、最後のマイルストンまで削除 → 先頭までスクロールして NEW MILESTONE が見える
          await openProject(c, q)
          const ms = (await api(c, 'window.gtd.milestones.list()')).filter((m) => m.projectId === q).map((m) => m.id)
          assert(ms.length === 6, 'マイルストン6件', ms)
          await c.evaluate(`(() => { const b = document.querySelector('[data-testid=milestone-board]'); b.scrollLeft = b.scrollWidth })()`)
          await sleep(200)
          assert((await board(c)).scrollLeft > 0, 'カード列が横スクロールしている')
          for (const id of ms.reverse()) await deleteEmptyMilestone(c, id)
          await sleep(300)
          b = await board(c)
          assert(b.cards === 0 && !b.note && b.children.length === 1 && b.newMilestoneLeft <= 1 && b.scrollLeft === 0 && b.newMilestoneVisible, '最後のマイルストンの削除直後も、案内文なし・左端・先頭にスクロール', b)

          // 完了済みプロジェクトの登録制約は従来どおり
          await api(c, `window.gtd.projects.setCompleted({ id: ${JSON.stringify(q)}, completed: true })`)
          await reload(c)
          await openProject(c, q)
          b = await board(c)
          assert(b.cards === 0 && !b.note && b.newMilestoneLeft <= 1 && (await c.evaluate(`document.querySelector('[data-testid=new-milestone-button]').disabled`)), '完了済みでは NEW MILESTONE は無効（位置は左端）', b)
          const quit = await requestQuit(app)
          assert(quit?.code === 0, '正常終了', quit)
        })
    ]
  ]
}
