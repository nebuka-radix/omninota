// Workspace（画面枠のUI状態）の契約。型と定数だけを置き、実行時依存を持たない。

// 最後に表示した画面として保存・復元できるルート
export const WORKSPACE_ROUTES = ['/inbox', '/settings'] as const
export type WorkspaceRoute = (typeof WORKSPACE_ROUTES)[number]

// ペイン幅の制約（px）。Rendererのパネル制約とMainの検証で共通に使う。
export const WORKSPACE_LIMITS = {
  sidebarWidth: { min: 180, max: 480 },
  detailWidth: { min: 220, max: 560 },
  // メインパネルの最小幅（保存はしない。ウィンドウ最小幅の計算に使う）
  mainMinWidth: 320,
  activityBarWidth: 48
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
  return typeof value === 'string' && (WORKSPACE_ROUTES as readonly string[]).includes(value)
}

export function clampWidth(value: number, limits: { min: number; max: number }): number {
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)))
}
