import { defineConfig } from 'vitest/config'

// ホストNode.js上で動く単体・結合テスト（Electronは起動しない）。
// better-sqlite3はNode-API版の同梱バイナリをホストNode.jsでそのまま読み込む。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
