import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'

// 画面共通の見出しと控えめなフェードイン（画面の切り替え時だけ）。Reduced Motion時はMotionConfigで無効になる。
// fill: 画面の高さいっぱいに広げ、内側の一覧などが自分でスクロールする（Inboxの仮想リスト用）。
// titleHidden: 見出しの行を表示しない（フェーズ5.7。Inbox・Project）。見出しは読み上げ用に残し、行の高さ・余白は取らない。
const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  m: 0,
  p: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0
} as const

export function Page({
  title,
  icon: Icon,
  fill = false,
  titleHidden = false,
  children
}: {
  title: string
  icon: LucideIcon
  fill?: boolean
  titleHidden?: boolean
  children: ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      style={fill ? { height: '100%' } : undefined}
    >
      <Box
        sx={{
          px: 5,
          py: 4,
          ...(fill && { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, boxSizing: 'border-box' })
        }}
      >
        {titleHidden ? (
          <Box component="h1" sx={visuallyHidden} data-testid="page-title">
            {title}
          </Box>
        ) : (
          <Box component="h1" sx={{ display: 'flex', alignItems: 'center', gap: 2, m: 0, mb: 3, flexShrink: 0 }} data-testid="page-title">
            <Icon size={18} strokeWidth={1.75} aria-hidden />
            <Typography component="span" sx={{ fontSize: 15, fontWeight: 600 }}>
              {title}
            </Typography>
          </Box>
        )}
        {children}
      </Box>
    </motion.div>
  )
}
