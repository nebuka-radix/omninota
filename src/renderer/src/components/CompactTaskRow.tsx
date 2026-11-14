import type { SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { Box, ButtonBase, Checkbox, Typography } from '@mui/material'
import { MoreHorizontal, Star } from 'lucide-react'
import { isTaskCompleted } from '../../../shared/contracts/tasks'
import { vscodeColors } from '../theme'
import { InlineTitleInput } from '../features/tasks/inline-title-edit'
import { dueLabelOf } from '../features/tasks/due-format'
import type { TaskRowProps } from './TaskRow'
const COMPACT_TASK_ROW_HEIGHT = 28
const HANDLE_COLUMN_WIDTH = 18
const taskOptionId = (id: string) => `task-option-${id}`

const stop = (event: SyntheticEvent) => event.stopPropagation()
const STAR_ON = '#e2c541'
const titleStyle = {
  display: 'inline-block', maxWidth: '100%', minWidth: 0, fontSize: 13,
  px: 0.5, cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis'
} as const

export function CompactTaskRow({ task, top, listId, controlsLayer, today, actions, selected, active, pending, dimmed, handle,
  onRowPointerDown, onRowClick, onRowContextMenu, onTitleClick, onTitleDoubleClick, onInlineDone }: TaskRowProps) {
  const completed = isTaskCompleted(task)
  const favorite = actions.isFavorite(task)
  const assignment = actions.assignmentLabel(task)
  const due = dueLabelOf(task.dueto, today)
  const withHandle = handle !== undefined
  const editing = actions.inlineEdit.state?.taskId === task.id
  const error = editing ? actions.inlineEdit.state?.error : null
  const opacity = pending || dimmed ? 0.5 : 1
  // 実表示と操作レイヤーで同じ列を使用し、タスク名の直後に…を配置する。
  const grid = {
    display: 'grid', alignItems: 'center', minWidth: 0, width: '100%', height: COMPACT_TASK_ROW_HEIGHT,
    gridTemplateColumns: `${withHandle ? `${HANDLE_COLUMN_WIDTH}px ` : ''}28px 20px minmax(0, max-content) 20px minmax(0, 1fr)`,
    boxSizing: 'border-box', pr: 0.5
  } as const
  const icon = { width: 20, height: 22, minWidth: 0, color: 'text.secondary', pointerEvents: 'auto', borderRadius: 0.5,
    '&:hover': { bgcolor: vscodeColors.listHover }, '&.Mui-focusVisible': { outline: `1px solid ${vscodeColors.focusBorder}` } } as const
  const assignmentStyle = {
    display: 'none', minWidth: 0, maxWidth: 240, justifySelf: 'end', pl: 2,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: 'text.secondary',
    '@container taskRows (min-width: 420px)': { display: 'block' }
  } as const
  const controls = (
    <Box data-list-id={listId} data-task-row-controls={task.id}
      onClick={stop} onDoubleClick={stop} onPointerDown={stop} onContextMenu={stop} onFocus={stop} onBlur={stop} onKeyDown={stop}
      onMouseDown={(event) => {
        event.stopPropagation()
        if (!(event.target instanceof HTMLElement && event.target.closest('input, textarea'))) event.preventDefault()
      }}
      sx={{ ...grid, position: 'absolute', left: 0, top, pointerEvents: 'none', opacity }}>
      {withHandle && <Box sx={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center' }}>{handle}</Box>}
      <span aria-hidden />
      <ButtonBase tabIndex={-1} aria-label={`「${task.title}」をお気に入り`} aria-pressed={favorite}
        title={favorite ? 'お気に入りを解除' : 'お気に入りに追加'} data-testid="task-favorite" data-favorite={favorite ? 'true' : 'false'}
        onClick={() => actions.toggleFavorite(task)} sx={{ ...icon, color: favorite ? STAR_ON : '#9a9a9a' }}>
        <Star size={14} aria-hidden fill={favorite ? STAR_ON : 'none'} />
      </ButtonBase>
      {/* 見えない同一テキストで、行本体と列幅を一致させる。編集欄は同じセルに重ねる。 */}
      <Box sx={{ minWidth: 0, position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Typography aria-hidden component="span" noWrap sx={{ ...titleStyle, visibility: 'hidden' }}>{task.title}</Typography>
        {editing && <Box data-testid="inline-title-editor-row" sx={{ position: 'absolute', inset: 0, minWidth: 0, pointerEvents: 'auto' }}>
          <InlineTitleInput controller={actions.inlineEdit} taskTitle={task.title} onDone={onInlineDone} />
        </Box>}
        {error && <Typography id="inline-title-error" role="alert" data-testid="inline-title-error"
          sx={{ position: 'absolute', top: 24, left: 0, zIndex: 4, bgcolor: 'background.paper', color: 'error.light', fontSize: 11, px: 1, pointerEvents: 'auto' }}>{error}</Typography>}
      </Box>
      <ButtonBase tabIndex={-1} aria-haspopup="menu" aria-label={`「${task.title}」のメニュー`} title="メニュー"
        data-testid="task-row-menu-button" data-row-menu-task-id={task.id}
        onClick={(event) => actions.openMenu(task, event.currentTarget, 'Compact')} sx={icon}>
        <MoreHorizontal size={14} aria-hidden />
      </ButtonBase>
      <Box aria-hidden sx={{ ...assignmentStyle, visibility: 'hidden' }}>{assignment}</Box>
    </Box>
  )
  return <>
    <Box id={taskOptionId(task.id)} role="option" aria-selected={selected} aria-busy={pending || undefined}
      aria-label={`${task.title}、${completed ? '完了' : '未完了'}${favorite ? '、お気に入り' : ''}${due ? `、${due.description}` : ''}${assignment ? `、${assignment}` : ''}`}
      data-task-id={task.id} data-task-row="" data-task-row-mode="Compact" data-pending={pending || undefined}
      onPointerDown={onRowPointerDown} onClick={onRowClick} onContextMenu={onRowContextMenu}
      sx={{ ...grid, position: 'absolute', left: 0, top: 0, transform: `translateY(${top}px)`, opacity,
        bgcolor: selected ? vscodeColors.listActiveSelection : 'transparent', borderBottom: `1px solid ${vscodeColors.border}40`,
        outline: active ? `1px solid ${vscodeColors.focusBorder}` : 'none', outlineOffset: -1,
        '&:hover': { bgcolor: selected ? vscodeColors.listActiveSelection : vscodeColors.listHover } }}>
      {withHandle && <span aria-hidden />}
      <Box aria-hidden onClick={stop} onPointerDown={stop} onDoubleClick={stop} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Checkbox size="small" checked={completed} disabled={pending} onChange={() => actions.toggleCompleted(task)} tabIndex={-1}
          slotProps={{ input: { 'aria-hidden': true, tabIndex: -1, 'data-testid': 'task-complete-checkbox' } as Record<string, unknown> }} sx={{ p: 0 }} />
      </Box>
      <span aria-hidden />
      <Typography component="span" noWrap data-testid="task-title" title={task.title}
        onClick={onTitleClick} onDoubleClick={onTitleDoubleClick}
        sx={{ ...titleStyle, visibility: editing ? 'hidden' : 'visible', textDecoration: completed ? 'line-through' : 'none',
          color: completed ? 'text.secondary' : 'text.primary', '&:hover': { textDecoration: 'underline' } }}>{task.title}</Typography>
      <span aria-hidden />
      <Box component="span" aria-hidden title={assignment ?? undefined} data-testid="task-assignment" sx={assignmentStyle}>{assignment}</Box>
    </Box>
    {controlsLayer && createPortal(controls, controlsLayer)}
  </>
}
