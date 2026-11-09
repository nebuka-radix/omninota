import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'

// 画面共通の見出しと控えめなフェードイン（画面の切り替え時だけ）。Reduced Motion時はMotionConfigで無効になる。
// fill: 画面の高さいっぱいに広げ、内側の一覧などが自分でスクロールする（Inboxの仮想リスト用）。
export function Page({
  title,
  icon: Icon,
  fill = false,
  children
}: {
  title: string
  icon: LucideIcon
  fill?: boolean
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
        <Box component="h1" sx={{ display: 'flex', alignItems: 'center', gap: 2, m: 0, mb: 3, flexShrink: 0 }}>
          <Icon size={18} strokeWidth={1.75} aria-hidden />
          <Typography component="span" sx={{ fontSize: 15, fontWeight: 600 }}>
            {title}
          </Typography>
        </Box>
        {children}
      </Box>
    </motion.div>
  )
}
