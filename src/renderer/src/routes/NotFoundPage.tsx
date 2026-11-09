import { Link as MuiLink, Typography } from '@mui/material'
import { Link } from '@tanstack/react-router'
import { CircleHelp } from 'lucide-react'
import { Page } from '../components/Page'

export function NotFoundPage() {
  return (
    <Page title="画面が見つかりません" icon={CircleHelp}>
      <Typography variant="body2" color="text.secondary">
        <MuiLink component={Link} to="/inbox">
          Inboxへ戻る
        </MuiLink>
      </Typography>
    </Page>
  )
}
