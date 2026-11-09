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

export const createTaskInputSchema = z.strictObject({ title: titleSchema })

export const updateTaskTitleInputSchema = z.strictObject({ id: taskIdSchema, title: titleSchema })

export const setTaskCompletedInputSchema = z.strictObject({
  id: taskIdSchema,
  completed: z.boolean({ error: '完了状態は true / false で指定してください。' })
})

export const tasksCreateArgsSchema = z.tuple([createTaskInputSchema])
export const tasksListArgsSchema = z.tuple([])
export const tasksUpdateTitleArgsSchema = z.tuple([updateTaskTitleInputSchema])
export const tasksSetCompletedArgsSchema = z.tuple([setTaskCompletedInputSchema])
