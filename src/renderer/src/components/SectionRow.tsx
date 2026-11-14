import type { ReactNode } from 'react'
import { Box, ButtonBase, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { ChevronDown, ChevronRight, Minus, type LucideIcon } from 'lucide-react'

export type SectionRowProps = {
  title: ReactNode
  /** タイトル前の個別アイコン。省略時はMinus。 */
  icon?: LucideIcon
  /** 表示状態は呼び出し側で管理する。省略時は展開状態。 */
  expanded?: boolean
  /** 未指定の場合、展開アイコンは表示するが操作不可。 */
  onExpandedChange?: (expanded: boolean) => void
  /** 折りたたむ内容のDOM ID。内容自体はSectionRowの外側で描画する。 */
  controlsId?: string
  /** タイトルのDOM ID。セクションのaria-labelledbyに使用可能。 */
  titleId?: string
  /** titleが文字列以外の場合などの読み上げ用セクション名。 */
  sectionLabel?: string
  /** 高さを固定する場合のみ指定する。未指定では内容に合わせる。 */
  height?: number | string
  sx?: SxProps<Theme>
}

/** セクションの見出しのみを描画する。配下の表示・非表示や状態の保存は呼び出し側の責務。 */
export function SectionRow({
  title,
  icon: Icon = Minus,
  expanded = true,
  onExpandedChange,
  controlsId,
  titleId,
  sectionLabel,
  height,
  sx = []
}: SectionRowProps) {
  const Chevron = expanded ? ChevronDown : ChevronRight
  const label = sectionLabel ?? (typeof title === 'string' ? title : 'セクション')

  return (
    <Box
      data-testid="section-row"
      data-expanded={expanded ? 'true' : 'false'}
      sx={[
        {
          display: 'flex', alignItems: 'center', minWidth: 0, flexShrink: 0,
          height, boxSizing: 'border-box', px: '12px', gap: '8px',
          bgcolor: '#2b2b2b', color: '#eeeeee',
          fontSize: '16px', fontWeight: 800
        },
        ...(Array.isArray(sx) ? sx : [sx])
      ]}
    >
      <ButtonBase
        type="button"
        aria-label={`${label}を${expanded ? '折りたたむ' : '展開する'}`}
        aria-expanded={expanded}
        aria-controls={controlsId}
        disabled={onExpandedChange === undefined}
        onClick={() => onExpandedChange?.(!expanded)}
        data-testid="section-row-toggle"
        sx={{
          width: 24, height: 24, flexShrink: 0, color: 'inherit',
          '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
          '&.Mui-focusVisible': { outline: '2px solid currentColor', outlineOffset: -2 }
        }}
      >
        <Chevron size={18} aria-hidden="true" />
      </ButtonBase>
      <Icon size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
      <Typography
        component="h2"
        id={titleId}
        noWrap
        data-testid="section-row-title"
        title={typeof title === 'string' ? title : undefined}
        sx={{ m: 0, minWidth: 0, fontSize: '16px', fontWeight: 800, lineHeight: 1.5, color: 'inherit' }}
      >
        {title}
      </Typography>
    </Box>
  )
}
