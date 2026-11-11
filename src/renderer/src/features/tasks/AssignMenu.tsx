import { useState } from 'react'
import { Divider, ListSubheader, Menu, MenuItem, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, FolderKanban, Flag } from 'lucide-react'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { milestoneListQueryOptions } from '../milestones/milestone-queries'
import { sortProjects } from '../projects/project-order'
import { projectListQueryOptions } from '../projects/project-queries'
import { disambiguatedNames, milestonesOf, type Assignment } from './assignment'

// Inboxの行から使う「紐付け」メニュー（フェーズ5.4）。2段階で選び、最終的な所属先を選んだ時点で1回だけ onChoose を呼ぶ。
// 1. プロジェクトを選ぶ（未完了のプロジェクトだけ。完了済みには追加できない。マイルストンが0件のプロジェクトは選べない）
// 2. そのプロジェクトのマイルストンを選ぶ（戻るも可）。フェーズ5.6で「このプロジェクトに紐付け（マイルストン未設定）」は廃止した
// Esc・外側のクリックで閉じた場合は何も保存しない。最後に使った所属先への自動割り当てはしない。
// キーボード: MUI の Menu（↑↓・Enter・Esc）。開いた時と段階が変わった時は先頭の項目にフォーカスする。
// フェーズ5.9: 複数タスク（Inboxの選択中のタスク）をまとめて紐付けられる。対象件数をメニューの見出しに示す。
//   マイルストンはカードと同じ順（手動順 → 作成順）
// TaskRow の紐付けアイコン: その行の1タスク。プロジェクト所属のタスクでは、現在のマイルストンを選べない項目として示す
//   （保存は呼び出し側。Inbox のタスクは Inbox からの紐付けAPI、プロジェクト所属のタスクは単体の所属変更API）
export function AssignMenu({
  tasks,
  anchor,
  onChoose,
  onClose
}: {
  tasks: readonly TaskDto[]
  anchor: HTMLElement
  onChoose: (assignment: Assignment) => void
  onClose: () => void
}) {
  // 1タスクの所属変更（プロジェクト所属のタスク）なら、その現在の所属
  const single = tasks.length === 1 ? tasks[0] : undefined
  const currentMilestoneId = single?.milestoneId ?? null
  const projects = useQuery(projectListQueryOptions)
  const milestones = useQuery(milestoneListQueryOptions)
  const [projectId, setProjectId] = useState<string | null>(null)

  const openProjects = sortProjects(projects.data ?? []).filter((project) => project.completedAt === null)
  const milestoneCount = (projectId: string) => milestonesOf(milestones.data ?? [], projectId).length
  const projectLabels = disambiguatedNames(projects.data ?? [])
  const chosenProject = openProjects.find((project) => project.id === projectId)

  const choose = (assignment: Assignment) => {
    onChoose(assignment)
    onClose()
  }

  let items
  if (projects.isPending || milestones.isPending) {
    items = [
      <MenuItem key="loading" disabled>
        読み込み中…
      </MenuItem>
    ]
  } else if (projects.isError || milestones.isError) {
    items = [
      <MenuItem key="error" disabled>
        プロジェクト・マイルストンを読み込めませんでした
      </MenuItem>
    ]
  } else if (!chosenProject) {
    items = [
      <ListSubheader key="title" sx={{ lineHeight: '28px', fontSize: 11 }}>
        {tasks.length > 1 ? `選択した ${tasks.length} 件の紐付け先のプロジェクト` : currentMilestoneId ? '移動先のプロジェクト' : '紐付け先のプロジェクト'}
      </ListSubheader>,
      ...(openProjects.length === 0
        ? [
            <MenuItem key="none" disabled>
              未完了のプロジェクトがありません（左の NEW PROJECT から作成）
            </MenuItem>
          ]
        : openProjects.map((project) => {
            // マイルストンが0件のプロジェクトには紐付けできない（理由を項目に示し、選べなくする）
            const empty = milestoneCount(project.id) === 0
            return (
              <MenuItem
                key={project.id}
                autoFocus={project.id === openProjects.find((item) => milestoneCount(item.id) > 0)?.id}
                disabled={empty}
                data-assign-project-id={project.id}
                onClick={() => setProjectId(project.id)}
                sx={{ fontSize: 13, gap: 1 }}
              >
                <FolderKanban size={14} aria-hidden />
                {projectLabels.get(project.id) ?? project.name}
                <Typography component="span" sx={{ ml: 'auto', pl: 2, fontSize: 11, color: 'text.secondary' }}>
                  {empty ? 'マイルストンなし' : <span aria-hidden>›</span>}
                </Typography>
              </MenuItem>
            )
          }))
    ]
  } else {
    const own = milestonesOf(milestones.data ?? [], chosenProject.id)
    const milestoneLabels = disambiguatedNames(own)
    const name = projectLabels.get(chosenProject.id) ?? chosenProject.name
    items = [
      <MenuItem key="back" onClick={() => setProjectId(null)} sx={{ fontSize: 12, gap: 1, color: 'text.secondary' }}>
        <ChevronLeft size={14} aria-hidden />
        プロジェクトの選択に戻る
      </MenuItem>,
      <Divider key="divider" />,
      <ListSubheader key="title" sx={{ lineHeight: '28px', fontSize: 11 }}>
        「{name}」
      </ListSubheader>,
      ...(own.length === 0
        ? [
            <MenuItem key="none" disabled>
              マイルストンがありません（プロジェクト画面で作成）
            </MenuItem>
          ]
        : []),
      ...own.map((milestone) => {
        const current = milestone.id === currentMilestoneId
        return (
          <MenuItem
            key={milestone.id}
            autoFocus={milestone.id === own.find((item) => item.id !== currentMilestoneId)?.id}
            disabled={current}
            data-assign-milestone-id={milestone.id}
            onClick={() => choose({ projectId: chosenProject.id, milestoneId: milestone.id })}
            sx={{ fontSize: 13, gap: 1 }}
          >
            <Flag size={14} aria-hidden />
            {milestoneLabels.get(milestone.id) ?? milestone.name}
            {current && (
              <Typography component="span" sx={{ ml: 'auto', pl: 2, fontSize: 11, color: 'text.secondary' }}>
                現在の所属
              </Typography>
            )}
          </MenuItem>
        )
      })
    ]
  }

  return (
    <Menu
      open
      anchorEl={anchor}
      onClose={onClose}
      slotProps={{
        list: { 'aria-label': tasks.length > 1 ? `選択した ${tasks.length} 件のタスクの紐付け先` : `「${tasks[0]?.title ?? ''}」の紐付け先`, dense: true },
        paper: { sx: { maxHeight: 420, minWidth: 260 } }
      }}
      data-testid="assign-menu"
    >
      {items}
    </Menu>
  )
}
