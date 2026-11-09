import { Box, Typography } from '@mui/material'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import { isWorkspaceRoute } from '../../../../shared/contracts/workspace'
import { appInfoQueryOptions } from '../../features/app-info/app-info-query'
import { taskKeys } from '../../features/tasks/task-queries'
import { useWorkspace } from '../../features/workspace/WorkspaceContext'
import { vscodeColors } from '../../theme'
import { SCREENS } from './screens'

// 実際に取得できる情報と、進行中・失敗した非同期処理だけを表示する。
// 「すべて保存済み」のような根拠のない表示はしない。長いパスは設定画面に集約する。
export function StatusBar({ pathname }: { pathname: string }) {
  const appInfo = useQuery(appInfoQueryOptions)
  // タスクの登録・更新（mutationKeyが ['tasks', ...] のもの）
  const savingTasks = useIsMutating({ mutationKey: taskKeys.all })
  const { saveStatus, persistenceEnabled } = useWorkspace()

  const screen = isWorkspaceRoute(pathname) ? SCREENS[pathname].label : '—'

  const messages: string[] = []
  if (savingTasks > 0) messages.push('タスクを保存中…')
  if (saveStatus === 'saving') messages.push('UI設定を保存中…')
  if (saveStatus === 'error') messages.push('UI設定を保存できませんでした')
  if (!persistenceEnabled) messages.push('UI設定を読み込めませんでした（既定の配置で表示・保存しません）')
  const hasError = saveStatus === 'error' || !persistenceEnabled || appInfo.isError

  let appText = ''
  if (appInfo.isError) appText = 'アプリ情報を取得できませんでした'
  else if (appInfo.isSuccess) appText = `${appInfo.data.name} ${appInfo.data.version} · ${appInfo.data.environment}`

  return (
    <Box
      component="footer"
      aria-label="ステータスバー"
      sx={{
        gridArea: 'status',
        bgcolor: hasError ? vscodeColors.statusBarErrorBackground : vscodeColors.statusBarBackground,
        color: vscodeColors.statusBarForeground,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        px: 3,
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        '& .MuiTypography-root': { fontSize: 12 }
      }}
    >
      <Typography component="span" data-testid="status-screen">
        {screen}
      </Typography>
      <Typography component="span" role="status" data-testid="status-messages" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {messages.join(' · ')}
      </Typography>
      <Typography component="span">{appText}</Typography>
    </Box>
  )
}
