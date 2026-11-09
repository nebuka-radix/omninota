import { createTheme } from '@mui/material/styles'

// VS Code風ダークテーマの配色。画面領域の色もここに集約する。
export const vscodeColors = {
  editorBackground: '#1e1e1e',
  sideBarBackground: '#252526',
  activityBarBackground: '#333333',
  titleBarBackground: '#3c3c3c',
  statusBarBackground: '#007acc',
  statusBarErrorBackground: '#c72e0f',
  statusBarForeground: '#ffffff',
  border: '#2b2b2b',
  foreground: '#cccccc',
  mutedForeground: '#9d9d9d',
  inactiveIcon: '#858585',
  focusBorder: '#007fd4',
  accent: '#3794ff',
  // 一覧の選択行・ホバー行
  listActiveSelection: '#04395e',
  listHover: '#2a2d2e',
  // ペインの境界線（ドラッグ・ホバー・フォーカス時はfocusBorder）
  sash: '#2b2b2b',
  scrollbarThumb: 'rgba(121, 121, 121, 0.4)',
  scrollbarThumbHover: 'rgba(100, 100, 100, 0.7)'
} as const

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: vscodeColors.accent },
    background: {
      default: vscodeColors.editorBackground,
      paper: vscodeColors.sideBarBackground
    },
    text: {
      primary: vscodeColors.foreground,
      secondary: vscodeColors.mutedForeground
    },
    divider: vscodeColors.border
  },
  shape: { borderRadius: 2 },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Segoe UI", sans-serif',
    fontSize: 13,
    button: { textTransform: 'none' }
  },
  spacing: 4,
  transitions: {
    // アニメーションは短く控えめにする。
    duration: {
      shortest: 80,
      shorter: 100,
      short: 120,
      standard: 150,
      complex: 200,
      enteringScreen: 120,
      leavingScreen: 100
    }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        'html, body, #root': { height: '100%' },
        body: { overflow: 'hidden', userSelect: 'none' },
        ':focus-visible': {
          outline: `1px solid ${vscodeColors.focusBorder}`,
          outlineOffset: -1
        },
        // スクロールバーの見た目を統一する（Chromium）
        '::-webkit-scrollbar': { width: 10, height: 10 },
        '::-webkit-scrollbar-track': { background: 'transparent' },
        '::-webkit-scrollbar-thumb': { backgroundColor: vscodeColors.scrollbarThumb },
        '::-webkit-scrollbar-thumb:hover': { backgroundColor: vscodeColors.scrollbarThumbHover },
        '::-webkit-scrollbar-corner': { background: 'transparent' },
        // OSの「視差効果を減らす」設定に合わせてCSSアニメーションを止める。
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important'
          }
        }
      }
    },
    MuiButtonBase: {
      defaultProps: { disableRipple: true }
    },
    MuiIconButton: {
      defaultProps: { size: 'small' }
    },
    MuiTooltip: {
      defaultProps: { disableInteractive: true, enterDelay: 400 }
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          '&:hover': { backgroundColor: vscodeColors.listHover },
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: vscodeColors.listActiveSelection },
          // 選択色とキーボードフォーカスを区別する（フォーカスは枠線で示す）
          '&.Mui-focusVisible': {
            backgroundColor: 'transparent',
            outline: `1px solid ${vscodeColors.focusBorder}`,
            outlineOffset: -1
          },
          '&.Mui-selected.Mui-focusVisible': { backgroundColor: vscodeColors.listActiveSelection }
        }
      }
    }
  }
})
