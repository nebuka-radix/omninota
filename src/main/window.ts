import { app, BrowserWindow, type Rectangle } from 'electron'
import { join } from 'node:path'
import { APP_IDENTITY } from '../shared/app-identity'
import { WORKSPACE_LIMITS } from '../shared/contracts/workspace'
import { isAllowedAppUrl } from './infrastructure/app-paths'

// 全ペインの最小幅を並べられるウィンドウ最小幅（境界線・余白として少し足す）
export const MIN_WINDOW_WIDTH =
  WORKSPACE_LIMITS.sidebarWidth.min +
  WORKSPACE_LIMITS.mainMinWidth +
  WORKSPACE_LIMITS.detailWidth.min +
  32

const indexHtmlPath = join(__dirname, '../renderer/index.html')
const preloadPath = join(__dirname, '../preload/index.js')

// 開発サーバーのURLは未パッケージ時だけ使う（配布後に環境変数で差し替えさせない）。
function getDevServerUrl(): string | null {
  const raw = process.env['ELECTRON_RENDERER_URL']
  if (app.isPackaged || !raw) return null
  return raw
}

export function isAppUrl(rawUrl: string): boolean {
  return isAllowedAppUrl(rawUrl, { devServerUrl: getDevServerUrl(), indexHtmlPath })
}

export const MIN_WINDOW_HEIGHT = 480
export const DEFAULT_WINDOW_SIZE = { width: 1200, height: 760 } as const

// ウィンドウの表示方法
// - normal: 通常起動・パッケージ版。準備ができたら表示する（従来どおり）
// - hidden: 自動テスト（GTD_TEST_UI=hidden）。表示しない
// - inactive: 自動テスト（GTD_TEST_UI=secondary）。指定位置に、フォーカスを奪わずに表示する（showInactive）
export type WindowPresentation = { kind: 'normal' } | { kind: 'hidden' } | { kind: 'inactive'; bounds: Rectangle }

export function createMainWindow(presentation: WindowPresentation = { kind: 'normal' }): BrowserWindow {
  const testing = presentation.kind !== 'normal'
  const win = new BrowserWindow({
    title: APP_IDENTITY.displayName,
    ...(presentation.kind === 'inactive' ? presentation.bounds : DEFAULT_WINDOW_SIZE),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      // 自動テストでは、非表示・非アクティブでも描画とタイマーを止めない
      backgroundThrottling: !testing
    }
  })

  if (presentation.kind === 'normal') {
    win.once('ready-to-show', () => win.show())
  } else if (presentation.kind === 'inactive') {
    win.once('ready-to-show', () => win.showInactive())
  }

  const devServerUrl = getDevServerUrl()
  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(indexHtmlPath)
  }

  return win
}
