import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'

// サイドバー・詳細パネル共通の見出し行
export function PaneHeader({ id, title, actions }: { id: string; title: string; actions?: ReactNode }) {
  return (
    <Box
      sx={{
        height: 34,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        pl: 4,
        pr: 1
      }}
    >
      <Typography
        id={id}
        component="h2"
        sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }}
      >
        {title}
      </Typography>
      {actions}
    </Box>
  )
}
