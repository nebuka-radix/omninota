import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

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
    plugins: [react()]
  }
})
