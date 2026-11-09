import type { Ref } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { PanelRight, PanelRightClose } from 'lucide-react'
import { APP_IDENTITY } from '../../../../shared/app-identity'
import { vscodeColors } from '../../theme'

// 上部の固定領域。ネイティブのタイトルバーはそのまま使う（独自タイトルバーは対象外）。
export function TopBar({
  detailVisible,
  onToggleDetail,
  toggleButtonRef
}: {
  detailVisible: boolean
  onToggleDetail: () => void
  toggleButtonRef: Ref<HTMLButtonElement>
}) {
  const label = detailVisible ? '詳細パネルを閉じる' : '詳細パネルを開く'
  const Icon = detailVisible ? PanelRightClose : PanelRight

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
        justifyContent: 'space-between',
        px: 3,
        minWidth: 0
      }}
    >
      <Typography component="span" sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>
        {APP_IDENTITY.displayName}
      </Typography>
      <Tooltip title={label}>
        <IconButton
          ref={toggleButtonRef}
          aria-label={label}
          aria-pressed={detailVisible}
          aria-controls="detail-panel"
          onClick={onToggleDetail}
          sx={{ color: 'text.secondary', borderRadius: 1 }}
        >
          <Icon size={16} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
