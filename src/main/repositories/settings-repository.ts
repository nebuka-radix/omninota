import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../db/client'
import { appSettings, type AppSettingRow } from '../db/schema'

// 設定キーは用途ごとに固定する（Rendererから任意のキーは指定させない）。
export const SETTINGS_KEYS = {
  workspace: 'workspace',
  windowState: 'windowState'
} as const
export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS]

export type SettingsRepository = {
  get(key: SettingsKey): AppSettingRow | undefined
  upsert(row: { key: SettingsKey; value: string; updatedAt: string }): void
}

export function createSettingsRepository(db: AppDatabase): SettingsRepository {
  return {
    get(key) {
      return db.select().from(appSettings).where(eq(appSettings.key, key)).get()
    },
    upsert(row) {
      db.insert(appSettings)
        .values(row)
        .onConflictDoUpdate({ target: appSettings.key, set: { value: row.value, updatedAt: row.updatedAt } })
        .run()
    }
  }
}
