import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

// アプリ設定。1つの設定分類につき1行（key）とし、値はバージョン付きJSON文字列で持つ。
// フェーズ3では key = 'workspace' だけを使う。値の検証は読み取り時にServiceで行う。
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  // UTCのISO 8601文字列
  updatedAt: text('updated_at').notNull()
})

export type AppSettingRow = typeof appSettings.$inferSelect
