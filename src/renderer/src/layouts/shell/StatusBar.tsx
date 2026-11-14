import { useState } from 'react'
import { Box, ButtonBase, Menu, MenuItem, Typography } from '@mui/material'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import { useShellSlotRef } from '../../components/ShellSlots'
import { appInfoQueryOptions } from '../../features/app-info/app-info-query'
import { taskKeys } from '../../features/tasks/task-queries'
import { useWorkspace } from '../../features/workspace/WorkspaceContext'
import { vscodeColors } from '../../theme'
import { SCREENS, screenOf } from './screens'

// 実際に取得できる情報と、進行中・失敗した非同期処理だけを表示する。
// 「すべて保存済み」のような根拠のない表示はしない。長いパスは設定画面に集約する。
// フェーズ5.8: 中央に現在の画面のタスク件数の差し込み先を置く（件数は一覧の部品が描画する。対象外の画面では空）。
// 左右を同じ幅の列（minmax(0, 1fr)）にして、左右の文字の長さで中央の位置がずれないようにする。狭い時は左右を省略表示する。
export function StatusBar({ pathname, compact, onChangeMode }: { pathname: string; compact: boolean; onChangeMode: (compact: boolean) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const appInfo = useQuery(appInfoQueryOptions)
  // タスクの登録・更新（mutationKeyが ['tasks', ...] のもの）
  const savingTasks = useIsMutating({ mutationKey: taskKeys.all })
  const { saveStatus, persistenceEnabled } = useWorkspace()
  const countRef = useShellSlotRef('status-count')

  const screenId = screenOf(pathname)
  const screen = compact ? 'コンパクト' : screenId ? SCREENS[screenId].label : '—'

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
        display: 'grid',
        gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) auto minmax(0, 1fr)',
        alignItems: 'center',
        columnGap: 4,
        px: 3,
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        '& .MuiTypography-root': { fontSize: 12 },
        ...(compact && {
          px: 1, columnGap: 0,
          '& [data-testid="status-left"]': { gap: 0 },
          '& [data-testid="status-screen"], & [data-testid="status-center"], & [data-testid="status-app"]': { display: 'none' }
        })
      }}
      data-testid="status-bar"
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' }} data-testid="status-left">
        <ButtonBase
          aria-label={`表示モード: ${compact ? 'コンパクト' : '通常'}`}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          aria-controls={anchor ? 'display-mode-menu' : undefined}
          onClick={(event) => setAnchor(event.currentTarget)}
          data-testid="display-mode-button"
          sx={{ fontSize: 12, flexShrink: 0, px: 1, height: 22, '&.Mui-focusVisible': { outline: '1px solid currentColor', outlineOffset: -2 } }}
        >
          表示モード: {compact ? 'コンパクト' : '通常'}
        </ButtonBase>
        <Menu id="display-mode-menu" anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
          <MenuItem selected={!compact} onClick={() => { setAnchor(null); onChangeMode(false) }}>通常</MenuItem>
          <MenuItem selected={compact} onClick={() => { setAnchor(null); onChangeMode(true) }}>コンパクト</MenuItem>
        </Menu>
        <Typography component="span" data-testid="status-screen" sx={{ flexShrink: 0 }}>
          {screen}
        </Typography>
        <Typography component="span" role="status" data-testid="status-messages" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {messages.join(' · ')}
        </Typography>
      </Box>
      <Box ref={countRef} data-testid="status-center" sx={{ display: 'flex', justifyContent: 'center', minWidth: 0 }} />
      <Typography component="span" data-testid="status-app" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' }}>
        {appText}
      </Typography>
    </Box>
  )
}

