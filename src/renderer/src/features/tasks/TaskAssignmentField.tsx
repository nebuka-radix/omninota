import { Alert, Box, TextField } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { milestoneListQueryOptions } from '../milestones/milestone-queries'
import { projectListQueryOptions } from '../projects/project-queries'
import { assignmentValue, buildAssignmentOptions, parseAssignmentValue, sameAssignment, type AssignmentOption } from './assignment'
import { useSetTaskAssignmentMutation } from './task-queries'

// 詳細パネルの所属選択（フェーズ5.4。5.2のプロジェクト選択を、プロジェクトとマイルストンの1つの選択に拡張）。
// - 選んだら、その所属（未所属／プロジェクトだけ／マイルストン）を1回で保存する（中間の状態を作らない）。
// - タイトルのドラフトとは別の操作。保存に成功しても入力中のタイトルは変えない。
// - 表示する値: 保存中は選んだ値、それ以外は保存済みの所属（失敗時は保存済みの所属へ戻り、理由を表示する）。
// - 同じタスクの更新が進行中（busy）の間は操作できない。ネイティブの select（キーボード・読み上げはOS標準の動作）。
export function TaskAssignmentField({ task, busy }: { task: TaskDto; busy: boolean }) {
  const projects = useQuery(projectListQueryOptions)
  const milestones = useQuery(milestoneListQueryOptions)
  const setAssignment = useSetTaskAssignmentMutation()

  const saved = { projectId: task.projectId, milestoneId: task.milestoneId }
  const value = setAssignment.isPending
    ? assignmentValue({ projectId: setAssignment.variables.projectId, milestoneId: setAssignment.variables.milestoneId })
    : assignmentValue(saved)

  const loading = projects.isPending || milestones.isPending
  const failed = projects.isError || milestones.isError
  const option = (item: AssignmentOption) => (
    <option key={item.value} value={item.value} disabled={item.disabled}>
      {item.label}
    </option>
  )

  let content
  let helper: string
  if (loading || failed || !projects.data || !milestones.data) {
    // 一覧を取得できない時は、現在値を「未所属」と誤って見せない
    content = option({
      value,
      label: loading ? '読み込み中…' : task.projectId === null ? '未所属（Inbox）' : '（所属先の名前を取得できません）',
      disabled: true
    })
    helper = loading ? 'プロジェクト一覧を読み込み中…' : 'プロジェクト・マイルストンの一覧を読み込めませんでした'
  } else {
    const built = buildAssignmentOptions(projects.data, milestones.data, saved)
    content = (
      <>
        {option(built.unassigned)}
        {built.groups.map((group) => (
          <optgroup key={group.label + group.options[0]?.value} label={group.label}>
            {group.options.map(option)}
          </optgroup>
        ))}
        {built.unknown && option(built.unknown)}
      </>
    )
    helper = setAssignment.isPending ? '保存中…' : '選ぶとすぐに保存します（完了済みのプロジェクトは選べません）'
  }

  return (
    <Box sx={{ mt: 4 }}>
      <TextField
        select
        label="所属（プロジェクト・マイルストン）"
        size="small"
        fullWidth
        value={value}
        disabled={busy || loading || failed}
        helperText={helper}
        onChange={(event) => {
          const next = parseAssignmentValue(event.target.value)
          if (sameAssignment(task, next) || busy) return
          setAssignment.reset()
          setAssignment.mutate({ id: task.id, ...next })
        }}
        slotProps={{
          select: { native: true },
          htmlInput: { 'data-testid': 'task-project-select', 'aria-busy': setAssignment.isPending }
        }}
      >
        {content}
      </TextField>
      {setAssignment.isError && (
        <Alert severity="error" variant="outlined" sx={{ mt: 2 }} onClose={() => setAssignment.reset()} data-testid="task-project-error">
          所属を変更できませんでした: {setAssignment.error.message}
        </Alert>
      )}
    </Box>
  )
}
