// Zodスキーマ。Mainだけがimportする（Preload / Rendererへ持ち込まない）。
import { z } from 'zod'
import { MILESTONE_NAME_MAX_LENGTH } from '../contracts/milestones'

const nameSchema = z
  .string({ error: 'マイルストン名は文字列で指定してください。' })
  .trim()
  .min(1, { error: 'マイルストン名を入力してください。' })
  .max(MILESTONE_NAME_MAX_LENGTH, { error: `マイルストン名は${MILESTONE_NAME_MAX_LENGTH}文字以内で入力してください。` })

export const milestonesListArgsSchema = z.tuple([])
export const milestonesCreateArgsSchema = z.tuple([
  z.strictObject({ projectId: z.uuid({ error: 'プロジェクトIDが正しくありません。' }), name: nameSchema })
])
export const milestonesRenameArgsSchema = z.tuple([
  z.strictObject({ id: z.uuid({ error: 'マイルストンIDが正しくありません。' }), name: nameSchema })
])

// 削除（フェーズ5.6）。確認した時の件数（0以上の整数）を添える
const milestoneIdSchema = z.uuid({ error: 'マイルストンIDが正しくありません。' })
const countSchema = z.number({ error: '件数は数値で指定してください。' }).int().min(0).max(Number.MAX_SAFE_INTEGER)
export const milestonesGetDeletionSummaryArgsSchema = z.tuple([z.strictObject({ id: milestoneIdSchema })])
export const milestonesDeleteArgsSchema = z.tuple([z.strictObject({ id: milestoneIdSchema, expectedTaskCount: countSchema })])
