import type { WorkspaceSettings } from '../../shared/contracts/workspace'
import { normalizeWorkspaceSettings } from '../../shared/validation/workspace'
import { SETTINGS_KEYS, type SettingsRepository } from '../repositories/settings-repository'

export type WorkspaceSettingsService = {
  // 保存値を検証・正規化して返す。読めない値でもDBは書き換えない（次の保存で置き換わる）。
  get(): WorkspaceSettings
  // inputはIPC層でZod検証済みであること。全体を置き換えて保存する。
  save(input: WorkspaceSettings): WorkspaceSettings
}

export function createWorkspaceSettingsService(deps: {
  repository: SettingsRepository
  now?: () => Date
  logger?: Pick<Console, 'warn'>
}): WorkspaceSettingsService {
  const now = deps.now ?? (() => new Date())
  const logger = deps.logger ?? console

  return {
    get() {
      const row = deps.repository.get(SETTINGS_KEYS.workspace)
      const result = normalizeWorkspaceSettings(row?.value)
      if (row && result.source !== 'saved') {
        logger.warn(`[settings] workspace設定を補正して読み込みました（${result.source}）`)
      }
      return result.settings
    },
    save(input) {
      const settings: WorkspaceSettings = {
        version: input.version,
        sidebarWidth: input.sidebarWidth,
        detailWidth: input.detailWidth,
        detailVisible: input.detailVisible,
        lastRoute: input.lastRoute
      }
      deps.repository.upsert({
        key: SETTINGS_KEYS.workspace,
        value: JSON.stringify(settings),
        updatedAt: now().toISOString()
      })
      return settings
    }
  }
}
