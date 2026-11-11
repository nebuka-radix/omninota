// Zodスキーマ。Mainだけがimportする（Preload / Rendererへ持ち込まない）。
import { z } from 'zod'
import { TASK_BULK_MAX, TASK_TITLE_MAX_LENGTH } from '../contracts/tasks'
import { isValidDateOnly } from '../date-only'

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

// 所属は「Inbox（両方なし）」か「プロジェクトとマイルストンの両方」だけを受け付ける（フェーズ5.6）。
// マイルストンだけ（5.4から拒否）と、プロジェクトだけ（5.6で廃止）は入力の段階で拒否する。組み合わせの整合性はServiceで確認する
const ASSIGNMENT_PAIR_REQUIRED = 'プロジェクトに所属させる場合は、そのプロジェクトのマイルストンも指定してください。'
const isPairedAssignment = (input: { projectId?: string | null | undefined; milestoneId?: string | null | undefined }) =>
  (input.projectId === null || input.projectId === undefined) === (input.milestoneId === null || input.milestoneId === undefined)

// projectId・milestoneId は省略可（フェーズ5.1までの呼び出しとの互換。省略時は未所属）
export const createTaskInputSchema = z
  .strictObject({ title: titleSchema, projectId: projectIdSchema.optional(), milestoneId: milestoneIdSchema.optional() })
  .refine(isPairedAssignment, { error: ASSIGNMENT_PAIR_REQUIRED })

export const updateTaskTitleInputSchema = z.strictObject({ id: taskIdSchema, title: titleSchema })

export const setTaskCompletedInputSchema = z.strictObject({
  id: taskIdSchema,
  completed: z.boolean({ error: '完了状態は true / false で指定してください。' })
})

// 所属の変更（フェーズ5.4）。projectId・milestoneId はどちらも必須（解除は null で明示する）
export const setTaskAssignmentInputSchema = z
  .strictObject({ id: taskIdSchema, projectId: projectIdSchema, milestoneId: milestoneIdSchema })
  .refine(isPairedAssignment, { error: ASSIGNMENT_PAIR_REQUIRED })

// 削除（フェーズ5.6）
export const deleteTaskInputSchema = z.strictObject({ id: taskIdSchema })

// 一括操作のID一覧（フェーズ5.9）: 1件以上・上限以内・重複なし（重複は入力の誤りとして拒否する）
const taskIdListSchema = z
  .array(taskIdSchema, { error: 'タスクIDの一覧を指定してください。' })
  .min(1, { error: 'タスクを1件以上指定してください。' })
  .max(TASK_BULK_MAX, { error: `一度に扱えるタスクは${TASK_BULK_MAX}件までです。` })
  .refine((ids) => new Set(ids).size === ids.length, { error: '同じタスクが重複して指定されています。' })

// Inboxからの一括紐付け: 移動先はプロジェクトとマイルストンの両方（Inboxへの移動・プロジェクトだけは受け付けない）
export const assignInboxTasksInputSchema = z.strictObject({
  ids: taskIdListSchema,
  projectId: z.uuid({ error: 'プロジェクトIDが正しくありません。' }),
  milestoneId: z.uuid({ error: 'マイルストンIDが正しくありません。' })
})

export const deleteTasksInputSchema = z.strictObject({ ids: taskIdListSchema })

// 並べ替え: マイルストンのタスク全件の新しい順序（0件の並べ替えはない）
export const reorderMilestoneTasksInputSchema = z.strictObject({
  milestoneId: z.uuid({ error: 'マイルストンIDが正しくありません。' }),
  orderedIds: taskIdListSchema
})

export const tasksCreateArgsSchema = z.tuple([createTaskInputSchema])
export const tasksListArgsSchema = z.tuple([])
export const tasksUpdateTitleArgsSchema = z.tuple([updateTaskTitleInputSchema])
export const tasksSetCompletedArgsSchema = z.tuple([setTaskCompletedInputSchema])
export const tasksSetAssignmentArgsSchema = z.tuple([setTaskAssignmentInputSchema])
export const tasksDeleteArgsSchema = z.tuple([deleteTaskInputSchema])
export const tasksAssignFromInboxArgsSchema = z.tuple([assignInboxTasksInputSchema])
export const tasksDeleteManyArgsSchema = z.tuple([deleteTasksInputSchema])
export const tasksReorderInMilestoneArgsSchema = z.tuple([reorderMilestoneTasksInputSchema])

// 期限（フェーズ6）: 日付のみ "YYYY-MM-DD"。形式だけでなく実在する暦日か（2月30日などを拒否）を確かめる
export const dateOnlySchema = z
  .string({ error: '日付は文字列で指定してください。' })
  .refine(isValidDateOnly, { error: '日付が正しくありません（実在する日付を YYYY-MM-DD で指定してください）。' })

export const setTaskDueInputSchema = z.strictObject({
  id: taskIdSchema,
  due: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('today') }),
    z.strictObject({ kind: z.literal('tomorrow') }),
    z.strictObject({ kind: z.literal('date'), date: dateOnlySchema }),
    z.strictObject({ kind: z.literal('clear') })
  ])
})
export const tasksSetDueArgsSchema = z.tuple([setTaskDueInputSchema])

// お気に入り: 目的の状態（真偽値だけ。0 / 1 や文字列は受け付けない）
export const setTaskFavoriteInputSchema = z.strictObject({
  id: taskIdSchema,
  favorite: z.boolean({ error: 'お気に入りは true / false で指定してください。' })
})
export const tasksSetFavoriteArgsSchema = z.tuple([setTaskFavoriteInputSchema])
export const summaryGetArgsSchema = z.tuple([])
