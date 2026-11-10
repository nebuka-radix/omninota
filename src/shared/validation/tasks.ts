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

// projectId は省略可（フェーズ5.1までの呼び出しとの互換。省略時は未所属）
export const createTaskInputSchema = z.strictObject({ title: titleSchema, projectId: projectIdSchema.optional() })

export const updateTaskTitleInputSchema = z.strictObject({ id: taskIdSchema, title: titleSchema })

export const setTaskCompletedInputSchema = z.strictObject({
  id: taskIdSchema,
  completed: z.boolean({ error: '完了状態は true / false で指定してください。' })
})

export const setTaskProjectInputSchema = z.strictObject({ id: taskIdSchema, projectId: projectIdSchema })

export const tasksCreateArgsSchema = z.tuple([createTaskInputSchema])
export const tasksListArgsSchema = z.tuple([])
export const tasksUpdateTitleArgsSchema = z.tuple([updateTaskTitleInputSchema])
export const tasksSetCompletedArgsSchema = z.tuple([setTaskCompletedInputSchema])
export const tasksSetProjectArgsSchema = z.tuple([setTaskProjectInputSchema])
