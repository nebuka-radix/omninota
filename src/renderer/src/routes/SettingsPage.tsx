import { Alert, Box, CircularProgress, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { Settings } from 'lucide-react'
import { Page } from '../components/Page'
import { appInfoQueryOptions } from '../features/app-info/app-info-query'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <Typography component="dt" variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, userSelect: 'text', wordBreak: 'break-all' }}>
        {value}
      </Typography>
    </>
  )
}

export function SettingsPage() {
  const appInfo = useQuery(appInfoQueryOptions)

  return (
    <Page title="設定" icon={Settings}>
      <Typography variant="subtitle2" sx={{ mb: 2 }}>
        アプリ情報
      </Typography>
      {appInfo.isPending && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }} role="status">
          <CircularProgress size={14} aria-hidden />
          <Typography variant="body2">取得中…</Typography>
        </Box>
      )}
      {appInfo.isError && (
        <Alert severity="error" variant="outlined">
          アプリ情報の取得に失敗しました: {appInfo.error.message}
        </Alert>
      )}
      {appInfo.isSuccess && (
        <Box
          component="dl"
          data-testid="app-info"
          sx={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 1.5, columnGap: 4, m: 0 }}
        >
          <InfoRow label="名前" value={appInfo.data.name} />
          <InfoRow label="バージョン" value={appInfo.data.version} />
          <InfoRow label="実行環境" value={appInfo.data.environment} />
          <InfoRow label="userData" value={appInfo.data.userDataPath} />
          <InfoRow label="データベース" value={appInfo.data.databasePath} />
          <InfoRow label="Electron" value={appInfo.data.versions.electron} />
          <InfoRow label="Chromium" value={appInfo.data.versions.chrome} />
          <InfoRow label="Node.js" value={appInfo.data.versions.node} />
          <InfoRow label="プラットフォーム" value={`${appInfo.data.platform} / ${appInfo.data.arch}`} />
        </Box>
      )}
    </Page>
  )
}
