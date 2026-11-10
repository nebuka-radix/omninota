// Workspace（画面枠のUI状態）の契約。型と定数だけを置き、実行時依存を持たない。

// 最後に表示した画面として保存・復元できるルート（フェーズ5.1で /projects と /projects/<UUID> を追加）
// - 固定のルートは列挙した値だけ
// - プロジェクトのルートは「/projects/」+ 小文字のUUID だけ（任意のパスや外部URLは受け付けない）
export const WORKSPACE_STATIC_ROUTES = ['/inbox', '/settings', '/projects'] as const
export type WorkspaceStaticRoute = (typeof WORKSPACE_STATIC_ROUTES)[number]
export type ProjectRoute = `/projects/${string}`
export type WorkspaceRoute = WorkspaceStaticRoute | ProjectRoute

// Main側で生成するUUID（crypto.randomUUID()は小文字）の形
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const PROJECT_ROUTE_PATTERN = /^\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

export function projectRoute(projectId: string): ProjectRoute {
  return `/projects/${projectId}`
}

// /projects/<UUID> ならプロジェクトIDを返す。それ以外はnull
export function projectIdFromRoute(route: string): string | null {
  return PROJECT_ROUTE_PATTERN.exec(route)?.[1] ?? null
}

// ペイン幅の制約（px）。Rendererのパネル制約とMainの検証で共通に使う。
export const WORKSPACE_LIMITS = {
  sidebarWidth: { min: 180, max: 480 },
  detailWidth: { min: 220, max: 560 },
  // メインパネルの最小幅（保存はしない。ウィンドウ最小幅の計算に使う）
  mainMinWidth: 320
} as const

// 保存形式のバージョン。形式を変えるときに上げ、読み取り時に移行・検証する。
export const WORKSPACE_SETTINGS_VERSION = 1

export type WorkspaceSettings = {
  version: typeof WORKSPACE_SETTINGS_VERSION
  sidebarWidth: number
  detailWidth: number
  detailVisible: boolean
  lastRoute: WorkspaceRoute
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  version: WORKSPACE_SETTINGS_VERSION,
  sidebarWidth: 240,
  detailWidth: 300,
  detailVisible: true,
  lastRoute: '/inbox'
}

export function isWorkspaceRoute(value: unknown): value is WorkspaceRoute {
  if (typeof value !== 'string') return false
  return (WORKSPACE_STATIC_ROUTES as readonly string[]).includes(value) || PROJECT_ROUTE_PATTERN.test(value)
}

export function clampWidth(value: number, limits: { min: number; max: number }): number {
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)))
}
