// Zodスキーマ。Mainだけがimportする（Preload / Rendererへ持ち込まない）。
import { z } from 'zod'
import { TASK_TITLE_MAX_LENGTH } from '../contracts/tasks'

const titleSchema = z
  .string({ error: 'タイトルは文字列で指定してください。' })
  .trim()
  .min(1, { error: 'タイトルを入力してください。' })
  .max(TASK_TITLE_MAX_LENGTH, { error: `タイトルは${TASK_TITLE_MAX_LENGTH}文字以内で入力してください。` })

// タスクIDはMain側で crypto.randomUUID() により生成したUUID
const taskIdSchema = z.uuid({ error: 'タスクIDが正しくありません。' })

// プロジェクトIDもMain側で生成したUUID。nullは未所属
const projectIdSchema = z.uuid({ error: 'プロジェクトIDが正しくありません。' }).nullable()

const milestoneIdSchema = z.uuid({ error: 'マイルストンIDが正しくありません。' }).nullable()

// マイルストンだけを指定した形（プロジェクトなし）は入力の段階で拒否する（フェーズ5.4）
const MILESTONE_WITHOUT_PROJECT = 'マイルストンを指定する場合は、プロジェクトも指定してください。'
const hasProjectForMilestone = (input: { projectId?: string | null | undefined; milestoneId?: string | null | undefined }) =>
  input.milestoneId === null || input.milestoneId === undefined || (input.projectId !== null && input.projectId !== undefined)

// projectId・milestoneId は省略可（フェーズ5.1までの呼び出しとの互換。省略時は未所属）
export const createTaskInputSchema = z
  .strictObject({ title: titleSchema, projectId: projectIdSchema.optional(), milestoneId: milestoneIdSchema.optional() })
  .refine(hasProjectForMilestone, { error: MILESTONE_WITHOUT_PROJECT })

export const updateTaskTitleInputSchema = z.strictObject({ id: taskIdSchema, title: titleSchema })

export const setTaskCompletedInputSchema = z.strictObject({
  id: taskIdSchema,
  completed: z.boolean({ error: '完了状態は true / false で指定してください。' })
})

// 所属の変更（フェーズ5.4）。projectId・milestoneId はどちらも必須（解除は null で明示する）
export const setTaskAssignmentInputSchema = z
  .strictObject({ id: taskIdSchema, projectId: projectIdSchema, milestoneId: milestoneIdSchema })
  .refine(hasProjectForMilestone, { error: MILESTONE_WITHOUT_PROJECT })

export const tasksCreateArgsSchema = z.tuple([createTaskInputSchema])
export const tasksListArgsSchema = z.tuple([])
export const tasksUpdateTitleArgsSchema = z.tuple([updateTaskTitleInputSchema])
export const tasksSetCompletedArgsSchema = z.tuple([setTaskCompletedInputSchema])
export const tasksSetAssignmentArgsSchema = z.tuple([setTaskAssignmentInputSchema])
