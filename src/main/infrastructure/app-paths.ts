// 保存先・同梱ファイル・許可URLの解決。Electronに依存しない純粋な関数だけを置く
// （ホストNode.jsのテストからimportできるようにするため）。
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_IDENTITY } from '../../shared/app-identity'

export const DATABASE_FILE_NAME = 'gtd.sqlite'
export const MIGRATIONS_DIR_NAME = 'migrations'

// 通常利用（パッケージ版）は GTD、開発・previewは GTD-dev を使う。
// devOverrideDir（環境変数 GTD_DEV_USER_DATA_DIR）は未パッケージ時だけ、絶対パスの場合に限り使う。
// パッケージ版では無視する（配布後に環境変数で保存先を差し替えさせない）。
export function resolveUserDataDir(options: {
  isPackaged: boolean
  appDataDir: string
  devOverrideDir?: string | undefined
}): string {
  if (!options.isPackaged && options.devOverrideDir && isAbsolute(options.devOverrideDir)) {
    return options.devOverrideDir
  }
  const dirName = options.isPackaged ? APP_IDENTITY.userDataDirName : APP_IDENTITY.devUserDataDirName
  return join(options.appDataDir, dirName)
}

export function resolveDatabaseFile(userDataDir: string): string {
  return join(userDataDir, DATABASE_FILE_NAME)
}

// マイグレーションSQLの場所。
// - 開発・preview: プロジェクト直下の migrations/（app.getAppPath() はプロジェクトルート）
// - パッケージ版: extraResources で Contents/Resources/migrations/ に同梱
export function resolveMigrationsDir(options: {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, MIGRATIONS_DIR_NAME)
    : join(options.appPath, MIGRATIONS_DIR_NAME)
}

// アプリ自身の画面として扱うURLかどうか。ナビゲーションとIPC送信元の検証に使う。
export function isAllowedAppUrl(
  rawUrl: string,
  options: { devServerUrl: string | null; indexHtmlPath: string }
): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (options.devServerUrl) {
    return url.origin === new URL(options.devServerUrl).origin
  }
  const indexUrl = pathToFileURL(options.indexHtmlPath)
  return url.protocol === 'file:' && url.pathname === indexUrl.pathname
}
