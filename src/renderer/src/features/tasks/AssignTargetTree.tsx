import { useState } from 'react'
import { Box, ButtonBase, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Flag, FolderKanban } from 'lucide-react'
import { milestoneListQueryOptions } from '../milestones/milestone-queries'
import { sortProjects } from '../projects/project-order'
import { projectListQueryOptions } from '../projects/project-queries'
import { vscodeColors } from '../../theme'
import { disambiguatedNames, milestonesOf } from './assignment'
import { useTaskDrag } from './TaskDragContext'

const PROJECT_NOT_DROPPABLE = 'プロジェクトにはドロップできません。マイルストンへドロップしてください'
const NO_MILESTONE = 'マイルストンがありません（プロジェクト画面で作成してください）'

// Inboxの右サイドバー「紐付け先」（フェーズ5.9）。未完了のプロジェクトと、その配下のマイルストン（カードと同じ順）。
// - タスクのドロップ先はマイルストンだけ（data-drop-milestone-id）。プロジェクトの行・マイルストンが0件のプロジェクトには
//   ドロップできない（data-drop-blocked で理由を示す）。完了済み・削除済みのプロジェクト・マイルストンは表示しない。
// - 同名のプロジェクト・マイルストンは、作成日時とIDの先頭で区別する。
// - プロジェクトは展開・折りたたみできる（既定は展開。保存しない）。
// - キーボードでの紐付けは、一覧の M キー・行のメニューの「紐付け…」から行う（このツリーはドロップ先の表示）。
export function AssignTargetTree() {
  const projects = useQuery(projectListQueryOptions)
  const milestones = useQuery(milestoneListQueryOptions)
  const { dragging } = useTaskDrag()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  if (projects.isPending || milestones.isPending) {
    return <Message>読み込み中…</Message>
  }
  if (projects.isError || milestones.isError) {
    return <Message>プロジェクト・マイルストンを読み込めませんでした。</Message>
  }
  const openProjects = sortProjects(projects.data).filter((project) => project.completedAt === null)
  const projectLabels = disambiguatedNames(openProjects)

  const toggle = (projectId: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })

  return (
    <Box sx={{ px: 2, py: 2 }} data-testid="assign-target-tree">
      <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0, mb: 1.5, px: 1 }}>
        Inbox のタスクをマイルストンへドラッグすると紐付けます（キーボードは一覧で M）。
      </Typography>
      {openProjects.length === 0 ? (
        <Message>未完了のプロジェクトがありません（左の NEW PROJECT から作成）。</Message>
      ) : (
        <Box component="ul" aria-label="紐付け先（プロジェクトとマイルストン）" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {openProjects.map((project) => {
            const label = projectLabels.get(project.id) ?? project.name
            const own = milestonesOf(milestones.data, project.id)
            const milestoneLabels = disambiguatedNames(own)
            const expanded = !collapsed.has(project.id)
            const Chevron = expanded ? ChevronDown : ChevronRight
            return (
              <Box component="li" key={project.id} data-testid="assign-target-project" data-project-id={project.id}>
                <ButtonBase
                  aria-expanded={expanded}
                  aria-label={`${label}（マイルストン ${own.length} 件）`}
                  onClick={() => toggle(project.id)}
                  data-drop-blocked={PROJECT_NOT_DROPPABLE}
                  data-tree-project-id={project.id}
                  sx={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    gap: 1,
                    px: 1,
                    height: 26,
                    borderRadius: 0.5,
                    fontSize: 13,
                    '&:hover': { bgcolor: vscodeColors.listHover },
                    '&.Mui-focusVisible': { outline: `1px solid ${vscodeColors.focusBorder}`, outlineOffset: -1 }
                  }}
                >
                  <Chevron size={14} aria-hidden style={{ flexShrink: 0 }} />
                  <FolderKanban size={14} aria-hidden style={{ flexShrink: 0 }} />
                  <Typography component="span" noWrap sx={{ fontSize: 13, minWidth: 0 }} title={label}>
                    {label}
                  </Typography>
                </ButtonBase>
                {expanded && (
                  <Box component="ul" aria-label={`${label}のマイルストン`} sx={{ listStyle: 'none', m: 0, p: 0, pl: 3 }}>
                    {own.length === 0 ? (
                      <Box
                        component="li"
                        data-drop-blocked={NO_MILESTONE}
                        data-testid="assign-target-empty"
                        sx={{ px: 1, height: 24, display: 'flex', alignItems: 'center', fontSize: 12, color: 'text.secondary' }}
                      >
                        マイルストンがありません（ドロップできません）
                      </Box>
                    ) : (
                      own.map((milestone) => {
                        const name = milestoneLabels.get(milestone.id) ?? milestone.name
                        const over = dragging?.overMilestoneId === milestone.id
                        return (
                          <Box
                            component="li"
                            key={milestone.id}
                            data-testid="assign-target-milestone"
                            data-drop-milestone-id={milestone.id}
                            data-drop-project-id={project.id}
                            data-drop-label={`${label} › ${name}`}
                            aria-label={`マイルストン「${name}」`}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1,
                              px: 1,
                              height: 26,
                              borderRadius: 0.5,
                              fontSize: 13,
                              // ドラッグ中はドロップできる場所を破線で示し、ポインターの下のマイルストンを強調する
                              outline: dragging ? `1px dashed ${over ? vscodeColors.focusBorder : vscodeColors.border}` : 'none',
                              outlineOffset: -1,
                              bgcolor: over ? vscodeColors.listActiveSelection : 'transparent'
                            }}
                          >
                            <Flag size={13} aria-hidden style={{ flexShrink: 0 }} />
                            <Typography component="span" noWrap sx={{ fontSize: 13, minWidth: 0 }} title={name}>
                              {name}
                            </Typography>
                          </Box>
                        )
                      })
                    )}
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

function Message({ children }: { children: string }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ px: 1 }} role="status">
      {children}
    </Typography>
  )
}
