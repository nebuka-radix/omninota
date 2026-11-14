import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import {
  clampWidth,
  isWorkspaceRoute,
  WORKSPACE_LIMITS,
  type MilestoneLayout,
  type WorkspaceRoute,
  type WorkspaceSettings
} from '../../../../shared/contracts/workspace'
import { unwrapIpc } from '../../lib/ipc'
import { createLatestWinsSaver, type LatestWinsSaver, type SaveStatus } from './latest-wins-saver'
import { setWorkspaceFlushHandler } from './workspace-flush'

// Workspace状態
// - settings: 保存対象（左右ペインの希望幅・詳細パネル表示・最後の画面）
//   幅はユーザーが境界線を直接操作して決めた「希望幅」。画面上の実寸はAppShellが計算する。
// - selectedTaskId: 詳細パネルの表示対象（保存しない）
// - selectionScope: 選択した時の一覧の表示範囲（Inbox / プロジェクト。フェーズ5.2）。
//   別の範囲の一覧を開いたら選択を解除する（同じ範囲へ戻った時は維持する）
// - 現在の画面はRouterが正本。lastRouteは次回起動用のスナップショットとして追従させる。
type State = {
  settings: WorkspaceSettings
  // ユーザー操作で設定が変わるたびに増やす。0の間（起動直後）は保存しない。
  revision: number
  selectedTaskId: string | null
  selectionScope: string | null
  saveStatus: SaveStatus
  // 「未完了のタスクを表示」の要求回数（右の詳細パネルの完了操作 → メインパネルの一覧。保存しない。フェーズ5.5）
  revealOpenRequest: number
  // Inboxの右サイドバーの表示（フェーズ5.9。保存しない）: targets = 紐付け先のツリー / detail = タスクの詳細。
  // Inboxに入った時は targets。行の選択だけでは切り替えない（Enter・メニューの「詳細を表示」・タブで切り替える）
  inboxPanel: InboxPanel
}

export type InboxPanel = 'targets' | 'detail'

type Action =
  | { type: 'setSidebarWidth'; width: number }
  | { type: 'setDetailWidth'; width: number }
  | { type: 'setDetailVisible'; visible: boolean }
  | { type: 'setMilestoneCardWidth'; width: number }
  | { type: 'setMilestoneLayout'; layout: MilestoneLayout }
  | { type: 'setInboxPanel'; panel: InboxPanel }
  | { type: 'requestRevealOpen' }
  | { type: 'setLastRoute'; route: WorkspaceRoute }
  | { type: 'selectTask'; taskId: string | null }
  | { type: 'enterScope'; scope: string }
  | { type: 'setSaveStatus'; status: SaveStatus }

function updateSettings(state: State, patch: Partial<WorkspaceSettings>): State {
  const next = { ...state.settings, ...patch }
  const changed = (Object.keys(patch) as (keyof WorkspaceSettings)[]).some((key) => next[key] !== state.settings[key])
  return changed ? { ...state, settings: next, revision: state.revision + 1 } : state
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setSidebarWidth':
      return updateSettings(state, { sidebarWidth: clampWidth(action.width, WORKSPACE_LIMITS.sidebarWidth) })
    case 'setDetailWidth':
      return updateSettings(state, { detailWidth: clampWidth(action.width, WORKSPACE_LIMITS.detailWidth) })
    case 'setDetailVisible':
      return updateSettings(state, { detailVisible: action.visible })
    case 'setMilestoneCardWidth':
      return updateSettings(state, { milestoneCardWidth: clampWidth(action.width, WORKSPACE_LIMITS.milestoneCardWidth) })
    case 'setMilestoneLayout':
      return updateSettings(state, { milestoneLayout: action.layout })
    case 'setInboxPanel':
      return state.inboxPanel === action.panel ? state : { ...state, inboxPanel: action.panel }
    case 'requestRevealOpen':
      return { ...state, revealOpenRequest: state.revealOpenRequest + 1 }
    case 'setLastRoute':
      return updateSettings(state, { lastRoute: action.route })
    case 'selectTask':
      return state.selectedTaskId === action.taskId ? state : { ...state, selectedTaskId: action.taskId }
    case 'enterScope':
      if (state.selectionScope === action.scope) return state
      // Inboxに入った時は、右サイドバーを紐付け先のツリーにする（フェーズ5.9）
      return {
        ...state,
        selectionScope: action.scope,
        selectedTaskId: null,
        inboxPanel: action.scope === 'inbox' ? 'targets' : state.inboxPanel
      }
    case 'setSaveStatus':
      return state.saveStatus === action.status ? state : { ...state, saveStatus: action.status }
  }
}

type WorkspaceContextValue = {
  settings: WorkspaceSettings
  selectedTaskId: string | null
  saveStatus: SaveStatus
  // 起動時の読み込みに失敗した場合はfalse（既定値で表示し、保存もしない）
  persistenceEnabled: boolean
  setSidebarWidth: (width: number) => void
  setDetailWidth: (width: number) => void
  setDetailVisible: (visible: boolean) => void
  // マイルストンカードの幅（全カード共通）。ドラッグ中は呼ばず、確定した時だけ呼ぶ（呼ぶたびに保存される）
  setMilestoneCardWidth: (width: number) => void
  // カードの並べ方（全プロジェクト共通。呼ぶたびに保存される。フェーズ5.9）
  setMilestoneLayout: (layout: MilestoneLayout) => void
  inboxPanel: InboxPanel
  setInboxPanel: (panel: InboxPanel) => void
  revealOpenRequest: number
  requestRevealOpenTasks: () => void
  selectTask: (taskId: string | null) => void
  // 一覧（表示範囲）を開いた時に呼ぶ。前回と別の範囲なら選択を解除する
  enterTaskScope: (scope: string) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({
  initialSettings,
  persistenceEnabled,
  children
}: {
  initialSettings: WorkspaceSettings
  persistenceEnabled: boolean
  children: ReactNode
}) {
  const [state, dispatch] = useReducer(reducer, {
    settings: initialSettings,
    revision: 0,
    selectedTaskId: null,
    selectionScope: null,
    saveStatus: 'idle',
    revealOpenRequest: 0,
    inboxPanel: 'targets'
  })

  // 保存キュー（コンポーネントの生存期間中は1つだけ）
  const saverRef = useRef<LatestWinsSaver<WorkspaceSettings> | null>(null)
  useEffect(() => {
    const saver = createLatestWinsSaver<WorkspaceSettings>({
      save: async (settings) => {
        await unwrapIpc(window.gtd.workspace.save(settings))
      },
      onStatusChange: (status, error) => {
        if (status === 'error') console.error('[workspace] UI設定の保存に失敗しました', error)
        dispatch({ type: 'setSaveStatus', status })
      }
    })
    saverRef.current = saver
    return () => {
      saver.dispose()
      saverRef.current = null
    }
  }, [])

  // 終了・ウィンドウを閉じる前の問い合わせに、確定済みの最新値の保存結果で答える。
  // 起動時の読み込みに失敗した場合は保存しない方針のため disabled を返す。
  useEffect(
    () =>
      setWorkspaceFlushHandler(async () => {
        if (!persistenceEnabled) return 'disabled'
        return saverRef.current ? saverRef.current.flush() : 'nothing'
      }),
    [persistenceEnabled]
  )

  // ユーザー操作による変更だけを保存する（起動時の復元値や既定値は書き込まない）。
  useEffect(() => {
    if (!persistenceEnabled || state.revision === 0) return
    saverRef.current?.schedule(state.settings)
  }, [persistenceEnabled, state.revision, state.settings])

  // Routerの現在位置を、次回起動用のスナップショットとして追従させる。
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname })
  useEffect(() => {
    if (isWorkspaceRoute(pathname)) dispatch({ type: 'setLastRoute', route: pathname })
  }, [pathname])

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      settings: state.settings,
      selectedTaskId: state.selectedTaskId,
      saveStatus: state.saveStatus,
      persistenceEnabled,
      setSidebarWidth: (width) => dispatch({ type: 'setSidebarWidth', width }),
      setDetailWidth: (width) => dispatch({ type: 'setDetailWidth', width }),
      setDetailVisible: (visible) => dispatch({ type: 'setDetailVisible', visible }),
      setMilestoneCardWidth: (width) => dispatch({ type: 'setMilestoneCardWidth', width }),
      setMilestoneLayout: (layout) => dispatch({ type: 'setMilestoneLayout', layout }),
      inboxPanel: state.inboxPanel,
      setInboxPanel: (panel) => dispatch({ type: 'setInboxPanel', panel }),
      revealOpenRequest: state.revealOpenRequest,
      requestRevealOpenTasks: () => dispatch({ type: 'requestRevealOpen' }),
      selectTask: (taskId) => dispatch({ type: 'selectTask', taskId }),
      enterTaskScope: (scope) => dispatch({ type: 'enterScope', scope })
    }),
    [state.settings, state.selectedTaskId, state.saveStatus, state.revealOpenRequest, state.inboxPanel, persistenceEnabled]
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace は WorkspaceProvider の内側で使ってください')
  return value
}
