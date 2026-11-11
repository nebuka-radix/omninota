import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// 開発サーバー（npm run dev）のポート。GTD_DEV_RENDERER_PORT がある時だけ、そのポートに固定する（使えなければ起動しない）。
// 開発起動の終了処理の自動検証（フェーズ5.9）で、専用のポートを使い、終了後の解放を確かめるためのもの。通常は未設定（Viteの既定）。
const devRendererPort = Number(process.env['GTD_DEV_RENDERER_PORT']) || undefined

export default defineConfig({
  // Main: package.jsonのdependenciesは外部依存として残る（既定）。
  main: {},
  // sandbox付きPreloadはelectron以外をrequireできないため、依存をすべてバンドルする。
  preload: {
    build: {
      externalizeDeps: false
    }
  },
  renderer: {
    plugins: [react()],
    server: devRendererPort ? { port: devRendererPort, strictPort: true, host: '127.0.0.1' } : {}
  }
})
