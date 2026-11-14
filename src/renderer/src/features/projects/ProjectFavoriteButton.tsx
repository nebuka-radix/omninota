import { useRef } from 'react'
import { Alert, Box, IconButton, Snackbar, Tooltip } from '@mui/material'
import { Star } from 'lucide-react'
import type { ProjectDto } from '../../../../shared/contracts/projects'
import { usePendingProjectIds, useSetProjectFavoriteMutation } from './project-queries'

/** 行の選択・開閉・画面遷移とは独立した、お気に入り切り替え。 */
export function ProjectFavoriteButton({ project }: { project: ProjectDto }) {
  const mutation = useSetProjectFavoriteMutation()
  const pendingIds = usePendingProjectIds()
  const busy = useRef(false)
  const label = `「${project.name}」を${project.favorite ? 'お気に入りから解除' : 'お気に入りに追加'}`
  const toggle = async () => {
    if (busy.current || pendingIds.has(project.id)) return
    busy.current = true
    try {
      await mutation.mutateAsync({ id: project.id, favorite: !project.favorite })
    } catch {
      // エラーはmutation.errorをSnackbarへ表示する。
    } finally { busy.current = false }
  }
  return (
    <Box component="span" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()} sx={{ display: 'inline-flex', flexShrink: 0 }}>
      <Tooltip title={label}>
        <span style={{ display: 'inline-flex' }}>
          <IconButton aria-label={label} aria-pressed={project.favorite} disabled={pendingIds.has(project.id)}
            data-testid="project-favorite" data-project-favorite-id={project.id} data-favorite={project.favorite ? 'true' : 'false'}
            onClick={() => void toggle()} sx={{ width: 24, height: 24, p: 0, color: project.favorite ? '#e2c541' : '#9a9a9a' }}>
            <Star size={18} aria-hidden fill={project.favorite ? '#e2c541' : 'none'} strokeWidth={1.75} />
          </IconButton>
        </span>
      </Tooltip>
      <Snackbar open={mutation.isError} onClose={() => mutation.reset()}>
        <Alert severity="error" onClose={() => mutation.reset()}>お気に入りを保存できませんでした: {mutation.error?.message}</Alert>
      </Snackbar>
    </Box>
  )
}
