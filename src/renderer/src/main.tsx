import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { installWorkspaceFlushListener } from './features/workspace/workspace-flush'
import { AppProviders } from './providers'
import { router } from './router'

const container = document.getElementById('root')
if (!container) {
  throw new Error('#root が見つかりません')
}

// 終了前の保存問い合わせは、画面の読み込み状態にかかわらず受け付ける。
installWorkspaceFlushListener()

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>
)
