import { Box, CircularProgress } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { DEFAULT_WORKSPACE_SETTINGS } from '../../../shared/contracts/workspace'
import { DraftGuardProvider } from '../features/drafts/DraftGuard'
import { NotesProvider } from '../features/notes/NotesContext'
import { workspaceSettingsQueryOptions } from '../features/workspace/workspace-queries'
import { WorkspaceProvider } from '../features/workspace/WorkspaceContext'
import { AppShell } from './shell/AppShell'
import { appInfoQueryOptions } from '../features/app-info/app-info-query'

// ルートの画面枠。保存済みのWorkspace設定を読み込んでから描画する
// （読み込み前に既定値でペインを作ると、復元時に幅が飛んだり既定値を保存したりするため）。
export function AppFrame() {
  const workspace = useQuery(workspaceSettingsQueryOptions)
  const appInfo = useQuery(appInfoQueryOptions)

  if (workspace.isPending || appInfo.isPending) {
    return (
      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }} role="status" aria-label="読み込み中">
        <CircularProgress size={18} aria-hidden />
      </Box>
    )
  }

  // 読み込みに失敗した場合は既定値で表示し、保存は行わない（DB上の値を上書きしないため）。
  const loaded = workspace.isSuccess
  return (
    <WorkspaceProvider initialSettings={loaded ? workspace.data : DEFAULT_WORKSPACE_SETTINGS} persistenceEnabled={loaded}>
      <DraftGuardProvider>
        <NotesProvider><AppShell initialCompact={appInfo.data?.compact ?? false} /></NotesProvider>
      </DraftGuardProvider>
    </WorkspaceProvider>
  )
}
