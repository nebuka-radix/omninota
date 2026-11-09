import { Box, IconButton, Tooltip } from '@mui/material'
import { useNavigate } from '@tanstack/react-router'
import { vscodeColors } from '../../theme'
import { SCREEN_ORDER, SCREENS, screenOf } from './screens'

// 固定幅のアクティビティバー。選択状態はRouterの現在位置から導出する。
export function ActivityBar({ pathname }: { pathname: string }) {
  const navigate = useNavigate()

  return (
    <Box
      component="nav"
      aria-label="アクティビティバー"
      sx={{
        width: 48,
        flexShrink: 0,
        bgcolor: vscodeColors.activityBarBackground,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 1,
        gap: 1
      }}
    >
      {SCREEN_ORDER.map((screen) => {
        const { label, icon: Icon, path } = SCREENS[screen]
        const active = screenOf(pathname) === screen
        return (
          <Tooltip key={screen} title={label} placement="right">
            <IconButton
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              onClick={() => void navigate({ to: path })}
              sx={{
                width: 48,
                height: 44,
                borderRadius: 0,
                color: active ? vscodeColors.foreground : vscodeColors.inactiveIcon,
                // 選択状態は左の線、キーボードフォーカスは枠線（テーマの:focus-visible）で区別する
                boxShadow: active ? `inset 2px 0 0 ${vscodeColors.foreground}` : 'none',
                '&:hover': { color: vscodeColors.foreground, bgcolor: 'transparent' }
              }}
            >
              <Icon size={22} strokeWidth={1.5} aria-hidden />
            </IconButton>
          </Tooltip>
        )
      })}
    </Box>
  )
}
