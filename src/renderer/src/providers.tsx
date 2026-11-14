import type { ReactNode } from 'react'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { LocalDayProvider } from './lib/local-day'
import { queryClient } from './lib/query-client'
import { theme } from './theme'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {/* OSの「視差効果を減らす」設定に従う */}
        <MotionConfig reducedMotion="user">
          {/* ローカルの「今日」（期限の表示・Summary Review。アプリ全体で1組のタイマー） */}
          <LocalDayProvider>{children}</LocalDayProvider>
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
