import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { APP_IDENTITY } from '../shared/app-identity'
import { WORKSPACE_LIMITS } from '../shared/contracts/workspace'
import { isAllowedAppUrl } from './infrastructure/app-paths'

// 全ペインの最小幅を並べられるウィンドウ最小幅（境界線・余白として少し足す）
const MIN_WINDOW_WIDTH =
  WORKSPACE_LIMITS.activityBarWidth +
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

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: APP_IDENTITY.displayName,
    width: 1200,
    height: 760,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: 480,
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
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  const devServerUrl = getDevServerUrl()
  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(indexHtmlPath)
  }

  return win
}
