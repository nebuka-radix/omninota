import { Inbox, Settings, type LucideIcon } from 'lucide-react'
import type { WorkspaceRoute } from '../../../../shared/contracts/workspace'

// 実在する画面の表示名とアイコン。ActivityBar・Sidebar・StatusBarで共通に使う。
export const SCREENS: Record<WorkspaceRoute, { label: string; icon: LucideIcon }> = {
  '/inbox': { label: 'Inbox', icon: Inbox },
  '/settings': { label: '設定', icon: Settings }
}

export const SCREEN_ORDER: readonly WorkspaceRoute[] = ['/inbox', '/settings']
