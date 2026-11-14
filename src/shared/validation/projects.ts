// Zodスキーマ。Mainだけがimportする（Preload / Rendererへ持ち込まない）。
import { z } from 'zod'
import { PROJECT_NAME_MAX_LENGTH } from '../contracts/projects'

// 文字数の数え方はタスクのタイトルと同じ（前後空白を除いた後の文字列長）。Rendererの入力欄のmaxLengthと一致する。
const nameSchema = z
  .string({ error: 'プロジェクト名は文字列で指定してください。' })
  .trim()
  .min(1, { error: 'プロジェクト名を入力してください。' })
  .max(PROJECT_NAME_MAX_LENGTH, { error: `プロジェクト名は${PROJECT_NAME_MAX_LENGTH}文字以内で入力してください。` })

const projectIdSchema = z.uuid({ error: 'プロジェクトIDが正しくありません。' })

export const createProjectInputSchema = z.strictObject({ name: nameSchema })
export const renameProjectInputSchema = z.strictObject({ id: projectIdSchema, name: nameSchema })

export const projectsListArgsSchema = z.tuple([])
export const projectsCreateArgsSchema = z.tuple([createProjectInputSchema])
export const projectsRenameArgsSchema = z.tuple([renameProjectInputSchema])

export const setProjectCompletedInputSchema = z.strictObject({
  id: projectIdSchema,
  completed: z.boolean({ error: '完了状態は true / false で指定してください。' })
})
export const projectsSetCompletedArgsSchema = z.tuple([setProjectCompletedInputSchema])
export const projectsSetFavoriteArgsSchema = z.tuple([z.strictObject({
  id: projectIdSchema,
  favorite: z.boolean({ error: 'お気に入りはtrue/falseで指定してください。' })
})])

// 削除（フェーズ5.6）。確認した時の件数（0以上の整数）を添える
const countSchema = z.number({ error: '件数は数値で指定してください。' }).int().min(0).max(Number.MAX_SAFE_INTEGER)
export const projectsGetDeletionSummaryArgsSchema = z.tuple([z.strictObject({ id: projectIdSchema })])
export const projectsDeleteArgsSchema = z.tuple([
  z.strictObject({ id: projectIdSchema, expectedMilestoneCount: countSchema, expectedTaskCount: countSchema })
])
