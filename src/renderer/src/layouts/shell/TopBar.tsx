import type { Ref } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { PanelRight, PanelRightClose } from 'lucide-react'
import { APP_IDENTITY } from '../../../../shared/app-identity'
import { useShellSlotRef } from '../../components/ShellSlots'
import { vscodeColors } from '../../theme'

// アプリ内トップバーの高さ（px）。フェーズ5.8で32px→40px（OSのタイトルバーは変えない）
export const TOP_BAR_HEIGHT = 40

// 上部の固定領域。ネイティブのタイトルバーはそのまま使う（独自タイトルバー・ドラッグ領域はない）。
// フェーズ5.8: 中央に現在の画面の表示設定（キーワード・状態・並べ替え）の差し込み先を置く。
// 表示設定を持つ画面（Inbox・プロジェクト）だけが中身を描画する。差し込み先は縮められ、狭い時も右の切り替えボタンへ重ならない。
export function TopBar({
  compact = false,
  detailVisible,
  onToggleDetail,
  toggleButtonRef
}: {
  compact?: boolean
  detailVisible: boolean
  onToggleDetail: () => void
  toggleButtonRef: Ref<HTMLButtonElement>
}) {
  const label = detailVisible ? '詳細パネルを閉じる' : '詳細パネルを開く'
  const Icon = detailVisible ? PanelRightClose : PanelRight
  const controlsRef = useShellSlotRef('top-bar-controls')

  return (
    <Box
      component="header"
      aria-label="トップバー"
      sx={{
        gridArea: 'top',
        bgcolor: vscodeColors.titleBarBackground,
        borderBottom: `1px solid ${vscodeColors.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        px: 3,
        minWidth: 0
      }}
      data-testid="top-bar"
    >
      <Typography component="span" sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', flexShrink: 0 }}>
        {APP_IDENTITY.displayName}
      </Typography>
      <Box
        ref={controlsRef}
        data-testid="top-bar-controls"
        sx={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'center', overflow: 'hidden', px: 0.5 }}
      />
      {!compact && <Tooltip title={label}>
        <IconButton
          ref={toggleButtonRef}
          aria-label={label}
          aria-pressed={detailVisible}
          aria-controls="detail-panel"
          onClick={onToggleDetail}
          sx={{ color: 'text.secondary', borderRadius: 1, flexShrink: 0 }}
        >
          <Icon size={16} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>}
    </Box>
  )
}

