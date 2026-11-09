import { Box } from '@mui/material'
import { Outlet } from '@tanstack/react-router'

// Routerの表示先。縦方向だけスクロールし、横スクロールは出さない。
export function MainPanel() {
  return (
    <Box
      component="main"
      aria-label="メインパネル"
      sx={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}
    >
      <Outlet />
    </Box>
  )
}
