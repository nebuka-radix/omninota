import { Box, Checkbox, FormControlLabel, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { groupProjects } from '../projects/project-order'
import { projectListQueryOptions } from '../projects/project-queries'
import { disambiguatedNames } from '../tasks/assignment'
import { summaryProjectFilter, useSummaryExcludedProjects } from './summary-project-filter'

// Summary Review の右サイドバー: プロジェクトごとの表示の ON／OFF（表示のフィルターだけ）。
// - 実在するプロジェクトすべて（この画面では完了済みも含む。完了済みは「完了済み」と補助表示）。削除されたプロジェクトは出さない。
// - 同名のプロジェクトは作成日時・ID で区別して表示する（状態は ID ごと）。初期はすべて ON。新しいプロジェクトも ON。
// - OFF にすると、そのプロジェクトに所属するタスクを Summary Review の全区画から外す。Inbox のタスクには影響しない。
// - タスク・プロジェクトのデータは変えない。状態はアプリのセッション中だけ保持する（summary-project-filter.ts）。
export function SummaryProjectFilter() {
  const projects = useQuery(projectListQueryOptions)
  const excluded = useSummaryExcludedProjects()
  if (projects.isPending) return <Message>読み込み中…</Message>
  if (projects.isError) return <Message>プロジェクトを読み込めませんでした。</Message>
  const groups = groupProjects(projects.data)
  const ordered = [...groups.open, ...groups.completed]
  const labels = disambiguatedNames(projects.data)
  return (
    <Box component="section" aria-labelledby="summary-filter-title" sx={{ px: 3, py: 2 }} data-testid="summary-project-filter">
      <Typography id="summary-filter-title" component="h2" sx={{ fontSize: 12, fontWeight: 600, m: 0, mb: 0.5 }}>
        表示するプロジェクト
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0, mb: 1 }}>
        OFF にしたプロジェクトのタスクを Summary Review に表示しません（Inbox のタスクは常に表示）。
      </Typography>
      {ordered.length === 0 ? (
        <Message>プロジェクトはありません。</Message>
      ) : (
        <Box role="group" aria-labelledby="summary-filter-title" sx={{ display: 'flex', flexDirection: 'column' }}>
          {ordered.map((project) => {
            const label = labels.get(project.id) ?? project.name
            return (
              <FormControlLabel
                key={project.id}
                data-project-id={project.id}
                data-testid="summary-project-filter-item"
                sx={{ m: 0, minWidth: 0, '& .MuiFormControlLabel-label': { minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 } }}
                control={
                  <Checkbox
                    size="small"
                    checked={!excluded.has(project.id)}
                    onChange={(event) => summaryProjectFilter.setOn(project.id, event.target.checked)}
                    sx={{ p: 0.5, mr: 0.5 }}
                  />
                }
                label={
                  <>
                    <Typography component="span" noWrap title={label} sx={{ fontSize: 13, minWidth: 0 }}>
                      {label}
                    </Typography>
                    {project.done && (
                      <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary', flexShrink: 0 }} data-testid="summary-project-done">
                        完了済み
                      </Typography>
                    )}
                  </>
                }
              />
            )
          })}
        </Box>
      )}
    </Box>
  )
}

function Message({ children }: { children: string }) {
  return (
    <Typography variant="body2" color="text.secondary" role="status" sx={{ px: 3 }}>
      {children}
    </Typography>
  )
}
