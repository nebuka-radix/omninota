import { Box } from '@mui/material'
import { Outlet } from '@tanstack/react-router'

// Routerの表示先。縦方向だけスクロールし、横スクロールは出さない。
// position: relative により、画面内の絶対配置の要素（読み上げ用の非表示テキストなど）もこの領域で切り取る
// （ウィンドウ全体が横スクロールしないようにする。フェーズ5.5）。
export function MainPanel() {
  return (
    <Box
      component="main"
      aria-label="メインパネル"
      sx={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', minWidth: 0, position: 'relative' }}
    >
      <Outlet />
    </Box>
  )
}
