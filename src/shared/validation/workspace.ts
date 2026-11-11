// Zodスキーマ。Mainだけがimportする（Preload / Rendererへ持ち込まない）。
import { z } from 'zod'
import { DRAFT_KINDS, WORKSPACE_FLUSH_OUTCOMES } from '../contracts/ipc'
import {
  clampWidth,
  DEFAULT_WORKSPACE_SETTINGS,
  MILESTONE_LAYOUTS,
  WORKSPACE_LIMITS,
  PROJECT_ROUTE_PATTERN,
  WORKSPACE_SETTINGS_VERSION,
  WORKSPACE_STATIC_ROUTES,
  type ProjectRoute,
  type WorkspaceSettings
} from '../contracts/workspace'

const width = (limits: { min: number; max: number }) => z.number().int().min(limits.min).max(limits.max)

// 保存要求の検証（厳格）。範囲外や余分なキーは拒否する。
export const workspaceSettingsSchema = z.strictObject({
  version: z.literal(WORKSPACE_SETTINGS_VERSION),
  sidebarWidth: width(WORKSPACE_LIMITS.sidebarWidth),
  detailWidth: width(WORKSPACE_LIMITS.detailWidth),
  detailVisible: z.boolean(),
  // 固定のルート、または /projects/<UUID>（保存要求の厳格な検証。読み取り時は下の正規化で扱う）
  lastRoute: z.union([
    z.enum(WORKSPACE_STATIC_ROUTES),
    z.custom<ProjectRoute>((value) => typeof value === 'string' && PROJECT_ROUTE_PATTERN.test(value))
  ]),
  milestoneCardWidth: width(WORKSPACE_LIMITS.milestoneCardWidth),
  milestoneLayout: z.enum(MILESTONE_LAYOUTS)
})

export const workspaceGetArgsSchema = z.tuple([])
export const workspaceSaveArgsSchema = z.tuple([workspaceSettingsSchema])
export const workspaceFlushResultArgsSchema = z.tuple([
  z.strictObject({
    requestId: z.uuid(),
    outcome: z.enum(WORKSPACE_FLUSH_OUTCOMES),
    draftKind: z.enum(DRAFT_KINDS).optional()
  })
])

export type NormalizeResult = {
  settings: WorkspaceSettings
  // saved: 保存値をそのまま使用 / repaired: 一部を補正 / default: 保存値なし・読めないため既定値
  source: 'saved' | 'repaired' | 'default'
}

const looseSchema = z.object({
  version: z.literal(WORKSPACE_SETTINGS_VERSION),
  sidebarWidth: z.unknown(),
  detailWidth: z.unknown(),
  detailVisible: z.unknown(),
  lastRoute: z.unknown(),
  // フェーズ5.5より前の保存値にはないため、キー自体を省略可能にする（ないことで他の項目まで既定値に戻さない）
  milestoneCardWidth: z.unknown().optional(),
  // フェーズ5.9より前の保存値にはない
  milestoneLayout: z.unknown().optional()
})

// DBから読み取った値（JSON文字列）を検証し、使える値に正規化する。
// - 値なし・JSONとして読めない・バージョン不一致 → 既定値
// - 幅が範囲外 → 範囲内に丸める / 型が違う・未知の画面 → その項目だけ既定値
// - milestoneCardWidth がない（フェーズ5.5より前の保存値）→ 既定値。補正ではなく正しい旧形式として扱う
// - milestoneLayout がない（フェーズ5.9より前の保存値）→ 既定値 column。同じく正しい旧形式として扱う。未知の値 → column（補正）
export function normalizeWorkspaceSettings(raw: string | undefined): NormalizeResult {
  if (raw === undefined) return { settings: DEFAULT_WORKSPACE_SETTINGS, source: 'default' }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return { settings: DEFAULT_WORKSPACE_SETTINGS, source: 'default' }
  }

  const loose = looseSchema.safeParse(parsedJson)
  if (!loose.success) return { settings: DEFAULT_WORKSPACE_SETTINGS, source: 'default' }

  const value = loose.data
  const defaults = DEFAULT_WORKSPACE_SETTINGS
  const toWidth = (input: unknown, limits: { min: number; max: number }, fallback: number) =>
    typeof input === 'number' && Number.isFinite(input) ? clampWidth(input, limits) : fallback

  const route = workspaceSettingsSchema.shape.lastRoute.safeParse(value.lastRoute)
  const layout = workspaceSettingsSchema.shape.milestoneLayout.safeParse(value.milestoneLayout)

  const settings: WorkspaceSettings = {
    version: WORKSPACE_SETTINGS_VERSION,
    sidebarWidth: toWidth(value.sidebarWidth, WORKSPACE_LIMITS.sidebarWidth, defaults.sidebarWidth),
    detailWidth: toWidth(value.detailWidth, WORKSPACE_LIMITS.detailWidth, defaults.detailWidth),
    detailVisible: typeof value.detailVisible === 'boolean' ? value.detailVisible : defaults.detailVisible,
    lastRoute: route.success ? route.data : defaults.lastRoute,
    milestoneCardWidth: toWidth(value.milestoneCardWidth, WORKSPACE_LIMITS.milestoneCardWidth, defaults.milestoneCardWidth),
    milestoneLayout: layout.success ? layout.data : defaults.milestoneLayout
  }

  // 旧形式で欠けている項目（追加された項目）は、既定値で補った上で「そのまま使える保存値」かを判定する
  const legacy =
    typeof parsedJson === 'object' && parsedJson !== null
      ? {
          ...('milestoneCardWidth' in parsedJson ? {} : { milestoneCardWidth: defaults.milestoneCardWidth }),
          ...('milestoneLayout' in parsedJson ? {} : { milestoneLayout: defaults.milestoneLayout }),
          ...parsedJson
        }
      : parsedJson
  const unchanged = workspaceSettingsSchema.safeParse(legacy).success
  return { settings, source: unchanged ? 'saved' : 'repaired' }
}
