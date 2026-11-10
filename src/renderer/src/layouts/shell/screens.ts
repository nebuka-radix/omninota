import { FolderKanban, Inbox, Settings, type LucideIcon } from 'lucide-react'

// 実在する画面の表示名・アイコン・移動先。ナビゲーション（NavigationPane）・StatusBarで共通に使う。
export type ScreenId = 'inbox' | 'projects' | 'settings'

export const SCREENS: Record<ScreenId, { label: string; icon: LucideIcon; path: '/inbox' | '/projects' | '/settings' }> = {
  inbox: { label: 'Inbox', icon: Inbox, path: '/inbox' },
  projects: { label: 'Project', icon: FolderKanban, path: '/projects' },
  settings: { label: '設定', icon: Settings, path: '/settings' }
}

export const SCREEN_ORDER: readonly ScreenId[] = ['inbox', 'projects', 'settings']

// 現在のパスがどの画面か（/projects・/projects/<ID>・/projects/new はどれも Project。
// 表示名だけを「Project」に変えた（フェーズ5.5）。ルート・API・テーブル名は projects のまま）
export function screenOf(pathname: string): ScreenId | null {
  if (pathname === '/inbox') return 'inbox'
  if (pathname === '/settings') return 'settings'
  if (pathname === '/projects' || pathname.startsWith('/projects/')) return 'projects'
  return null
}
