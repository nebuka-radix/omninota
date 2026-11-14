// 開発時のマイグレーション生成専用（npm run db:generate）。
// 配布アプリはdrizzle-kitを使わず、生成済みの migrations/ を起動時に適用する。
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema/index.ts',
  out: './migrations'
})
