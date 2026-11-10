import { Alert, Box, TextField } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { projectListQueryOptions } from '../projects/project-queries'
import { buildProjectOptions, toProjectIdValue, UNASSIGNED_VALUE } from './project-options'
import { useSetTaskProjectMutation } from './task-queries'

// 詳細パネルの所属選択（フェーズ5.2）。選んだら即時保存する。
// - タイトルのドラフトとは別の操作。保存に成功しても入力中のタイトルは変えない（TaskEditorのドラフトは独立した状態）。
// - 表示する値: 保存中は選んだ値、それ以外は保存済みの所属（失敗時は保存済みの所属へ戻り、理由を表示する）。
// - 同じタスクの更新が進行中（busy）の間は操作できない（重複操作の制限。更新自体も順番に実行される）。
// - ネイティブの select を使う（キーボード・読み上げはOS標準の動作）。
export function TaskProjectField({ task, busy }: { task: TaskDto; busy: boolean }) {
  const projects = useQuery(projectListQueryOptions)
  const setProject = useSetTaskProjectMutation()

  const savedValue = task.projectId ?? UNASSIGNED_VALUE
  const value = setProject.isPending ? (setProject.variables.projectId ?? UNASSIGNED_VALUE) : savedValue

  let options: { value: string; label: string; disabled: boolean }[]
  let helper: string
  if (projects.isPending) {
    options = [{ value, label: '読み込み中…', disabled: true }]
    helper = 'プロジェクト一覧を読み込み中…'
  } else if (projects.isError) {
    // 一覧を取得できない時は、現在値を「未所属」と誤って見せない
    options = [{ value, label: task.projectId === null ? '未所属（Inbox）' : '（プロジェクト名を取得できません）', disabled: true }]
    helper = `プロジェクト一覧を読み込めませんでした: ${projects.error.message}`
  } else {
    options = buildProjectOptions(projects.data, task.projectId)
    helper = setProject.isPending ? '保存中…' : '選ぶとすぐに保存します（完了済みのプロジェクトは選べません）'
  }

  const disabled = busy || projects.isPending || projects.isError

  return (
    <Box sx={{ mt: 4 }}>
      <TextField
        select
        label="プロジェクト"
        size="small"
        fullWidth
        value={value}
        disabled={disabled}
        helperText={helper}
        onChange={(event) => {
          const projectId = toProjectIdValue(event.target.value)
          if (projectId === task.projectId || busy) return
          setProject.reset()
          setProject.mutate({ id: task.id, projectId })
        }}
        slotProps={{
          select: { native: true },
          htmlInput: { 'data-testid': 'task-project-select', 'aria-busy': setProject.isPending }
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </TextField>
      {setProject.isError && (
        <Alert severity="error" variant="outlined" sx={{ mt: 2 }} onClose={() => setProject.reset()} data-testid="task-project-error">
          所属を変更できませんでした: {setProject.error.message}
        </Alert>
      )}
    </Box>
  )
}
