import type { ReactNode } from 'react'
import { Box, ButtonBase, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { ChevronDown, ChevronRight, Minus, type LucideIcon } from 'lucide-react'

export type SectionRowProps = {
  /** 0: section、1: subsection、2: subsubsection。非負整数。 */
  level?: number
  title: ReactNode
  /** 選択状態と選択操作。未指定なら従来の見出し表示。 */
  selected?: boolean
  onSelect?: () => void
  /** 行全体のクリックでも展開状態を切り替える。既定false。 */
  toggleOnRowClick?: boolean
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
  level = 0,
  title,
  selected = false,
  onSelect,
  toggleOnRowClick = false,
  icon: Icon = Minus,
  expanded = true,
  onExpandedChange,
  controlsId,
  titleId,
  sectionLabel,
  height,
  sx = []
}: SectionRowProps) {
  // TypeScriptのnumberには実数も渡せるため、有限の非負整数に正規化する。
  const normalizedLevel = Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0
  const leftMargin = normalizedLevel * 32
  const fontSize = Math.max(10, 16 - normalizedLevel * 2)
  const shade = Math.max(0, 43 - normalizedLevel * 4)
  const backgroundColor = `rgb(${shade}, ${shade}, ${shade})`
  const headingTag = `h${Math.min(6, 2 + normalizedLevel)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  const Chevron = expanded ? ChevronDown : ChevronRight
  const label = sectionLabel ?? (typeof title === 'string' ? title : 'セクション')

  return (
    <Box
      data-testid="section-row"
      data-selected={selected ? 'true' : 'false'}
      onClick={(event) => {
        const target = event.target instanceof Element ? event.target : null
        if (!target) return
        // 開閉ボタンは自身の処理に任せ、バブリングによる二重切り替えを防ぐ。
        if (target.closest('[data-testid="section-row-toggle"]')) return
        if (target.closest('input, textarea, select, a')) return
        const titleButton = target.closest('[data-testid="section-row-select"]')
        if (target.closest('button') && !titleButton) return
        // タイトルボタンではonSelectが既に実行される。それ以外の行内クリックではここで選択する。
        if (!titleButton) onSelect?.()
        if (toggleOnRowClick) onExpandedChange?.(!expanded)
      }}
      data-level={normalizedLevel}
      data-expanded={expanded ? 'true' : 'false'}
      sx={[
        {
          display: 'flex', alignItems: 'center', minWidth: 0, flexShrink: 0,
          height, boxSizing: 'border-box', ml: `${leftMargin}px`, px: '12px', gap: '8px',
          bgcolor: backgroundColor, color: '#eeeeee',
          boxShadow: selected ? 'inset 0 -1.5px 0 #00ff00' : undefined,
          fontSize: `${fontSize}px`, fontWeight: 800,
          cursor: toggleOnRowClick && onExpandedChange ? 'pointer' : undefined
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
        component={headingTag}
        id={titleId}
        noWrap
        data-testid="section-row-title"
        title={typeof title === 'string' ? title : undefined}
        sx={{ m: 0, minWidth: 0, fontSize: 'inherit', fontWeight: 'inherit', lineHeight: 1.5, color: 'inherit' }}
      >
        {onSelect ? (
          <ButtonBase type="button" onClick={onSelect} aria-pressed={selected}
            aria-label={`${label}を選択`} data-testid="section-row-select"
            sx={{ display: 'block', maxWidth: '100%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textAlign: 'left', fontSize: 'inherit', fontWeight: 'inherit', lineHeight: 'inherit', color: 'inherit',
              '&.Mui-focusVisible': { outline: '1px solid currentColor', outlineOffset: -1 } }}>
            {title}
          </ButtonBase>
        ) : title}
      </Typography>
    </Box>
  )
}
