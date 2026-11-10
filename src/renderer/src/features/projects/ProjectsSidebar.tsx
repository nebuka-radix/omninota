import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { PROJECT_NAME_MAX_LENGTH, type ProjectDto } from '../../../../shared/contracts/projects'
import { projectIdFromRoute } from '../../../../shared/contracts/workspace'
import { groupProjects } from './project-order'
import { projectListQueryOptions, useCreateProjectMutation } from './project-queries'

// Projectsの左サイドバー: 作成欄とプロジェクト一覧。
// - 作成欄の未送信の入力は、タスクの追加欄と同じく未保存確認（DraftGuard）の対象にしない。
// - プロジェクトの選択はルートの変更（未保存の編集があれば、遷移の前に既存の確認が出る）。
function ProjectCreateForm() {
  const [name, setName] = useState('')
  const create = useCreateProjectMutation()
  const navigate = useNavigate()
  const submittingRef = useRef(false)
  const blank = name.trim().length === 0

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (blank || submittingRef.current) return
    submittingRef.current = true
    create.mutate(
      { name },
      {
        onSuccess: (project) => {
          setName('')
          void navigate({ to: '/projects/$projectId', params: { projectId: project.id } })
        },
        onSettled: () => {
          submittingRef.current = false
        }
      }
    )
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 日本語IMEの変換確定のEnterでは作成しない
    if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault()
  }

  return (
    <Box component="form" onSubmit={submit} noValidate sx={{ px: 3, pb: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            if (create.isError) create.reset()
          }}
          onKeyDown={handleKeyDown}
          placeholder="新しいプロジェクト"
          size="small"
          fullWidth
          autoComplete="off"
          slotProps={{
            htmlInput: {
              'aria-label': '新しいプロジェクトの名前',
              maxLength: PROJECT_NAME_MAX_LENGTH,
              readOnly: create.isPending
            }
          }}
        />
        <Tooltip title="プロジェクトを作成">
          <span>
            <IconButton type="submit" aria-label="プロジェクトを作成" disabled={blank || create.isPending}>
              <Plus size={16} aria-hidden />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      {create.isError && (
        <Alert severity="error" variant="outlined" sx={{ mt: 1, py: 0 }}>
          作成できませんでした: {create.error.message}
        </Alert>
      )}
    </Box>
  )
}

export function ProjectsSidebar({ pathname }: { pathname: string }) {
  const projects = useQuery(projectListQueryOptions)
  const navigate = useNavigate()
  const selectedId = projectIdFromRoute(pathname)

  let body
  if (projects.isPending) {
    body = (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 4 }} role="status">
        <CircularProgress size={12} aria-hidden />
        <Typography variant="body2">読み込み中…</Typography>
      </Box>
    )
  } else if (projects.isError) {
    // 取得の失敗（IPC・DBエラー）。「プロジェクトがない」とは表示しない
    body = (
      <Alert severity="error" variant="outlined" sx={{ mx: 3 }}>
        プロジェクトを読み込めませんでした: {projects.error.message}
      </Alert>
    )
  } else if (projects.data.length === 0) {
    body = (
      <Typography variant="body2" color="text.secondary" sx={{ px: 4 }} role="status">
        プロジェクトはまだありません。
      </Typography>
    )
  } else {
    // 区分（未完了・完了済み）ごとに表示する。区分の中は名前順（同名は作成日時・ID）。選択はルートで決まるため、完了操作で区分が変わっても維持される
    const groups = groupProjects(projects.data)
    const renderItem = (project: ProjectDto) => {
      const selected = project.id === selectedId
      return (
        <ListItemButton
          key={project.id}
          selected={selected}
          aria-current={selected ? 'page' : undefined}
          data-project-id={project.id}
          onClick={() => void navigate({ to: '/projects/$projectId', params: { projectId: project.id } })}
          sx={{ px: 4 }}
        >
          <ListItemText
            primary={project.name}
            // 完了済みは色だけでなく文字でも示す
            secondary={project.completedAt !== null ? '完了済み' : undefined}
            slotProps={{ primary: { noWrap: true, sx: { fontSize: 13 } }, secondary: { sx: { fontSize: 11 } } }}
          />
        </ListItemButton>
      )
    }
    const section = (key: 'open' | 'completed', label: string, items: ProjectDto[]) => (
      <List
        key={key}
        dense
        disablePadding
        aria-labelledby={`project-section-${key}`}
        data-testid={`project-section-${key}`}
        subheader={
          <ListSubheader id={`project-section-${key}`} disableSticky sx={{ px: 4, lineHeight: '28px', fontSize: 11, bgcolor: 'transparent' }}>
            {label}（{items.length}）
          </ListSubheader>
        }
      >
        {items.length === 0 ? (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 4, py: 0.5, m: 0 }}>
            なし
          </Typography>
        ) : (
          items.map(renderItem)
        )}
      </List>
    )
    body = (
      <Box data-testid="project-list" aria-label="プロジェクト一覧" role="group">
        {section('open', '未完了', groups.open)}
        {section('completed', '完了済み', groups.completed)}
      </Box>
    )
  }

  return (
    <>
      <ProjectCreateForm />
      {body}
    </>
  )
}
