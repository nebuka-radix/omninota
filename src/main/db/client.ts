import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as schema from './schema'

export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database }

// 接続設定（理由は docs/database.md を参照）
// - journal_mode=WAL: 書き込み中も読み取りを妨げず、異常終了時も整合性を保ちやすい。
// - synchronous=FULL: 電源断・OS異常時の確定済みデータ消失を避けることを速度より優先する。
// - foreign_keys=ON: 後続フェーズの外部キーを有効にしておく（SQLiteの既定はOFF）。
// - busy_timeout=5000: 将来のバックアップ処理などと競合したときに即時失敗させない。
export function openDatabase(file: string): AppDatabase {
  // 親ディレクトリを作るだけで、既存ファイルの削除や初期化は行わない。
  mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('synchronous = FULL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')
    return drizzle(sqlite, { schema })
  } catch (error) {
    sqlite.close()
    throw error
  }
}

export function closeDatabase(db: AppDatabase): void {
  if (db.$client.open) {
    db.$client.close()
  }
}
