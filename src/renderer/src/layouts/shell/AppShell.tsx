import { useCallback, useRef, useState, type Ref } from 'react'
import { Box } from '@mui/material'
import { useRouterState } from '@tanstack/react-router'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { WORKSPACE_LIMITS } from '../../../../shared/contracts/workspace'
import { useDraftGuard } from '../../features/drafts/DraftGuard'
import type { PaneKey } from '../../features/workspace/pane-layout'
import { usePaneLayout } from '../../features/workspace/use-pane-layout'
import { useWorkspace } from '../../features/workspace/WorkspaceContext'
import { vscodeColors } from '../../theme'
import { ShellSlotsProvider } from '../../components/ShellSlots'
import { SummaryPage } from '../../routes/SummaryPage'
import { TaskDragProvider } from '../../features/tasks/TaskDragContext'
import { DetailPanel } from './DetailPanel'
import { MainPanel } from './MainPanel'
import { NavigationPane } from './NavigationPane'
import { StatusBar } from './StatusBar'
import { TOP_BAR_HEIGHT, TopBar } from './TopBar'

const { sidebarWidth: SIDEBAR, detailWidth: DETAIL, mainMinWidth } = WORKSPACE_LIMITS

// 境界線の幅。ドラッグ・ダブルクリックの判定範囲（resizeTargetMinimumSize）と一致させる。
const SEPARATOR_WIDTH = 6

const lineGradient = (color: string) =>
  `linear-gradient(90deg, transparent calc(50% - 0.5px), ${color} calc(50% - 0.5px), ${color} calc(50% + 0.5px), transparent calc(50% + 0.5px))`

// ペイン境界。キーボード操作（矢印・Home/End）とARIA属性はライブラリが提供する。
// ライブラリ既定のダブルクリック動作は無効にし、onDoubleClickで既定幅へ戻す（保存の対象を明確にするため）。
function PaneSeparator({
  id,
  label,
  pane,
  onOperate,
  onReset
}: {
  id: string
  label: string
  pane: PaneKey
  onOperate: (pane: PaneKey) => void
  onReset: (pane: PaneKey) => void
}) {
  return (
    <Separator
      id={id}
      aria-label={`${label}（ダブルクリックで既定の幅に戻す）`}
      className="pane-separator"
      disableDoubleClick
      onPointerDown={() => onOperate(pane)}
      onKeyDown={() => onOperate(pane)}
      onDoubleClick={() => onReset(pane)}
      style={{ width: SEPARATOR_WIDTH, outline: 'none' }}
    />
  )
}

const separatorStyles = {
  '& .pane-separator': {
    backgroundColor: vscodeColors.editorBackground,
    backgroundImage: lineGradient(vscodeColors.sash)
  },
  '& .pane-separator[data-separator="hover"], & .pane-separator[data-separator="active"], & .pane-separator[data-separator="focus"]':
    { backgroundImage: lineGradient(vscodeColors.focusBorder) },
  '& .pane-separator:focus-visible': { boxShadow: `inset 0 0 0 1px ${vscodeColors.focusBorder}` }
} as const

// 詳細パネル。defaultSizeはマウント時の希望幅に固定する（以後の幅はusePaneLayoutが適用する）。
function DetailPane({
  preferredWidth,
  elementRef,
  pathname,
  onClose,
  containerRef
}: {
  preferredWidth: number
  elementRef: Ref<HTMLDivElement>
  pathname: string
  onClose: () => void
  containerRef: Ref<HTMLElement>
}) {
  const [initialWidth] = useState(preferredWidth)
  return (
    <Panel
      id="detail"
      elementRef={elementRef}
      defaultSize={initialWidth}
      minSize={DETAIL.min}
      maxSize={DETAIL.max}
      groupResizeBehavior="preserve-pixel-size"
      style={{ backgroundColor: vscodeColors.sideBarBackground }}
    >
      <DetailPanel pathname={pathname} onClose={onClose} containerRef={containerRef} />
    </Panel>
  )
}

export function AppShell() {
  const { settings, setDetailVisible } = useWorkspace()
  const { confirmLeave } = useDraftGuard()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [compact, setCompact] = useState(false)
  const switchingRef = useRef(false)
  const changeMode = async (next: boolean) => {
    if (switchingRef.current || next === compact) return
    switchingRef.current = true
    try {
      if (await confirmLeave()) setCompact(next)
    } finally {
      switchingRef.current = false
    }
  }
  const pane = usePaneLayout(compact)
  const [initialSidebarWidth] = useState(settings.sidebarWidth)

  const toggleButtonRef = useRef<HTMLButtonElement>(null)
  const detailContainerRef = useRef<HTMLElement>(null)

  const toggleDetail = useCallback(async () => {
    if (!settings.detailVisible) {
      setDetailVisible(true)
      return
    }
    // 未保存の編集があれば、閉じる前に確認する（黙って破棄しない）
    if (!(await confirmLeave())) return
    // 閉じる前に、詳細パネル内にフォーカスがあればトップバーの切り替えボタンへ戻す。
    const focusInside = detailContainerRef.current?.contains(document.activeElement) ?? false
    setDetailVisible(false)
    if (focusInside) requestAnimationFrame(() => toggleButtonRef.current?.focus())
  }, [settings.detailVisible, setDetailVisible, confirmLeave])

  return (
    <ShellSlotsProvider>
      {/* Inboxのタスク → 右サイドバーの紐付け先へのドラッグ（メイン・詳細パネルをまたぐため画面枠に置く。フェーズ5.9） */}
      <TaskDragProvider>
      <Box
        sx={{
          height: '100%',
          display: 'grid',
          // トップバーの高さは TOP_BAR_HEIGHT（フェーズ5.8で32px→40px）。メイン領域は残りの高さ（1fr）を使う
          gridTemplateRows: `${TOP_BAR_HEIGHT}px minmax(0, 1fr) 22px`,
          gridTemplateColumns: 'minmax(0, 1fr)',
          gridTemplateAreas: '"top" "body" "status"',
          overflow: 'hidden',
          color: 'text.primary'
        }}
      >
        <TopBar compact={compact} detailVisible={settings.detailVisible} onToggleDetail={() => void toggleDetail()} toggleButtonRef={toggleButtonRef} />

        <Box sx={{ gridArea: 'body', display: 'flex', minWidth: 0, minHeight: 0, ...separatorStyles }}>
          {compact ? (
            <Box component="main" aria-label="メインパネル" data-testid="compact-screen" sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <SummaryPage compact />
            </Box>
          ) : (
          <Group
            id="workspace-panes"
            orientation="horizontal"
            groupRef={pane.groupRef}
            elementRef={pane.groupElementRef}
            onLayoutChanged={pane.handleLayoutChanged}
            resizeTargetMinimumSize={{ coarse: 20, fine: SEPARATOR_WIDTH }}
            style={{ flex: 1, minWidth: 0, height: '100%' }}
          >
            <Panel
              id="sidebar"
              elementRef={pane.sidebarElementRef}
              defaultSize={initialSidebarWidth}
              minSize={SIDEBAR.min}
              maxSize={SIDEBAR.max}
              groupResizeBehavior="preserve-pixel-size"
              style={{ backgroundColor: vscodeColors.sideBarBackground }}
            >
              {/* 幅広のナビゲーション（フェーズ5.4。旧アクティビティバー＋サイドバー）。幅の保存は従来の sidebarWidth を使う */}
              <NavigationPane pathname={pathname} />
            </Panel>
            <PaneSeparator
              id="sidebar-separator"
              label="ナビゲーションの幅を調整"
              pane="sidebar"
              onOperate={pane.markOperated}
              onReset={pane.resetToDefault}
            />
            <Panel
              id="main"
              elementRef={pane.mainElementRef}
              minSize={mainMinWidth}
              style={{ backgroundColor: vscodeColors.editorBackground }}
            >
              <MainPanel />
            </Panel>
            {settings.detailVisible && (
              <>
                <PaneSeparator
                  id="detail-separator"
                  label="詳細パネルの幅を調整"
                  pane="detail"
                  onOperate={pane.markOperated}
                  onReset={pane.resetToDefault}
                />
                <DetailPane
                  preferredWidth={settings.detailWidth}
                  elementRef={pane.detailElementRef}
                  pathname={pathname}
                  onClose={() => void toggleDetail()}
                  containerRef={detailContainerRef}
                />
              </>
            )}
          </Group>
          )}
        </Box>

        <StatusBar pathname={pathname} compact={compact} onChangeMode={(next) => void changeMode(next)} />
      </Box>
      </TaskDragProvider>
    </ShellSlotsProvider>
  )
}

