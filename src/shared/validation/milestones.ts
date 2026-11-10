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
