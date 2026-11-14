import { useRef } from 'react'
import { Alert, Box, IconButton, Snackbar, Tooltip } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { milestoneListQueryOptions, usePendingMilestoneIds, useSetMilestoneFavoriteMutation } from './milestone-queries'

export function MilestoneFavoriteButton({ milestoneId }: { milestoneId: string }) {
  const query = useQuery(milestoneListQueryOptions)
  const milestone = query.data?.find((item) => item.id === milestoneId)
  const pendingIds = usePendingMilestoneIds()
  const mutation = useSetMilestoneFavoriteMutation()
  const busy = useRef(false)
  const favorite = milestone?.favorite ?? false
  const label = `「${milestone?.name ?? 'マイルストン'}」を${favorite ? 'お気に入りから解除' : 'お気に入りに追加'}`
  const toggle = async () => {
    if (!milestone || busy.current || pendingIds.has(milestoneId)) return
    busy.current = true
    try { await mutation.mutateAsync({ id: milestoneId, favorite: !favorite }) }
    catch { /* mutation.errorで画面に表示する */ }
    finally { busy.current = false }
  }
  return (
    <Box component="span" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()} sx={{ display: 'inline-flex', flexShrink: 0 }}>
      <Tooltip title={label}>
        <span style={{ display: 'inline-flex' }}>
          <IconButton aria-label={label} aria-pressed={favorite} disabled={!milestone || pendingIds.has(milestoneId)}
            data-testid="milestone-favorite" data-milestone-favorite-id={milestoneId} data-favorite={favorite ? 'true' : 'false'}
            onClick={() => void toggle()} sx={{ width: 24, height: 24, p: 0, color: favorite ? '#ffa500' : '#9a9a9a' }}>
            <Star size={18} aria-hidden fill={favorite ? '#ffa500' : 'none'} strokeWidth={1.75} />
          </IconButton>
        </span>
      </Tooltip>
      <Snackbar open={mutation.isError} onClose={() => mutation.reset()}>
        <Alert severity="error" onClose={() => mutation.reset()}>お気に入りを保存できませんでした: {mutation.error?.message}</Alert>
      </Snackbar>
    </Box>
  )
}
