import { app, BrowserWindow, dialog, session } from 'electron'
import { APP_IDENTITY } from '../shared/app-identity'
import { IPC_CHANNELS, type AppInfo } from '../shared/contracts/ipc'
import { closeDatabase, openDatabase, type AppDatabase } from './db/client'
import { runMigrations } from './db/migrate'
import { resolveDatabaseFile, resolveMigrationsDir, resolveUserDataDir } from './infrastructure/app-paths'
import { registerIpcHandlers } from './ipc'
import {
  createExitCoordinator,
  createFlushRequester,
  type ExitKind,
  type FailureChoice,
  type FlushCheckOutcome
} from './lifecycle/workspace-flush'
import { createSettingsRepository } from './repositories/settings-repository'
import { createTaskRepository } from './repositories/task-repository'
import { createTaskService } from './services/task-service'
import { createWorkspaceSettingsService } from './services/workspace-settings-service'
import { createMainWindow, isAppUrl } from './window'

// userDataはreadyより前に確定させる。開発・previewは GTD-dev、パッケージ版は GTD。
app.setPath(
  'userData',
  resolveUserDataDir({
    isPackaged: app.isPackaged,
    appDataDir: app.getPath('appData'),
    // 検証用（未パッケージ時だけ有効）。大量データの確認などで、開発用DBを汚さずに一時DBを使う。
    devOverrideDir: process.env['GTD_DEV_USER_DATA_DIR']
  })
)

const databaseFile = resolveDatabaseFile(app.getPath('userData'))
const migrationsDir = resolveMigrationsDir({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath
})

let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null

// 終了・ウィンドウを閉じる前に、Rendererへ確定済みWorkspace状態の保存完了を問い合わせる。
// 破棄済みのウィンドウ・Rendererには送らない（unavailableとして扱う）。
const flushRequester = createFlushRequester({
  send: (requestId) => {
    const win = mainWindow
    if (!win || win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isCrashed()) return false
    win.webContents.send(IPC_CHANNELS.workspaceFlushRequest, requestId)
    return true
  }
})

async function askOnFlushFailure(outcome: FlushCheckOutcome, kind: ExitKind): Promise<FailureChoice> {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  const show = async (options: Electron.MessageBoxOptions) =>
    (parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)).response
  const discardLabel = kind === 'quit' ? '保存せずに終了' : '保存せずに閉じる'
  console.warn(`[exit] 保存を確認できないため、確認ダイアログを表示します（${outcome}）`)

  // 詳細パネルに未保存のタイトル編集がある場合。保存は画面側で行ってもらう（ここでは再試行しない）。
  if (outcome === 'unsaved-draft') {
    const response = await show({
      type: 'warning',
      buttons: ['キャンセル', discardLabel],
      defaultId: 0,
      cancelId: 0,
      message: 'タスクのタイトルに未保存の変更があります',
      detail: '保存する場合は「キャンセル」を選び、詳細パネルで保存してください。'
    })
    return response === 1 ? 'discard' : 'cancel'
  }

  const reason =
    outcome === 'timeout' ? '画面からの応答がありませんでした。' : 'UI設定（ペイン幅など）の保存に失敗しました。'
  const response = await show({
    type: 'warning',
    buttons: ['再試行', discardLabel, 'キャンセル'],
    defaultId: 0,
    cancelId: 2,
    message: 'UI設定を保存できませんでした',
    detail: `${reason}\nタスクのデータには影響しません。`
  })
  return response === 0 ? 'retry' : response === 1 ? 'discard' : 'cancel'
}

const exitCoordinator = createExitCoordinator({
  requestFlush: () => flushRequester.request(),
  askOnFailure: askOnFlushFailure,
  continueQuit: () => app.quit(),
  continueClose: () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
  }
})

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    exitCoordinator.resetForNewWindow()
    mainWindow = createMainWindow()
    // macOSでは、ウィンドウを閉じてもアプリは終了しない（既存方針）。
    // どちらの場合も、閉じる前に保存完了を確認する。
    mainWindow.on('close', (event) => exitCoordinator.onWindowCloseRequested(event))
    mainWindow.on('closed', () => {
      mainWindow = null
    })
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function applySecurityPolicies(): void {
  // 権限要求（通知、カメラ、位置情報など）は現時点ですべて拒否する。
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    console.warn(`[security] 権限要求を拒否しました: ${permission}`)
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)

  app.on('web-contents-created', (_event, contents) => {
    // アプリ外へのナビゲーションを禁止する。
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) {
        event.preventDefault()
        console.warn(`[security] ナビゲーションを拒否しました: ${url}`)
      }
    })
    contents.on('will-redirect', (event, url) => {
      if (!isAppUrl(url)) {
        event.preventDefault()
        console.warn(`[security] リダイレクトを拒否しました: ${url}`)
      }
    })
    // 新規ウィンドウは開かない。外部URLの許可は必要になった時点で個別に設計する。
    contents.setWindowOpenHandler(({ url }) => {
      console.warn(`[security] 新規ウィンドウを拒否しました: ${url}`)
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })
}

// DBを開き、マイグレーションを適用する。失敗時はファイルを削除・初期化せずに例外を投げる。
function initializeDatabase(): AppDatabase {
  const db = openDatabase(databaseFile)
  try {
    const result = runMigrations(db, migrationsDir)
    console.info(
      `[db] opened: ${databaseFile} (migrations applied: ${result.appliedBefore} -> ${result.appliedAfter})`
    )
    return db
  } catch (error) {
    closeDatabase(db)
    throw error
  }
}

function getAppInfo(): AppInfo {
  return {
    name: APP_IDENTITY.displayName,
    version: app.getVersion(),
    environment: app.isPackaged ? 'production' : 'development',
    userDataPath: app.getPath('userData'),
    databasePath: databaseFile,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    platform: process.platform,
    arch: process.arch
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  void app.whenReady().then(() => {
    applySecurityPolicies()
    console.info(`[app] userData: ${app.getPath('userData')} (packaged: ${app.isPackaged})`)

    try {
      database = initializeDatabase()
    } catch (error) {
      console.error('[db] データベースの初期化に失敗しました', error)
      dialog.showErrorBox(
        'データベースを開けませんでした',
        `データは削除・初期化していません。\n\n保存先: ${databaseFile}\n\n` +
          (error instanceof Error ? error.message : String(error))
      )
      app.exit(1)
      return
    }

    // マイグレーション完了後にIPC（タスクAPI）を登録する。
    registerIpcHandlers({
      policy: { getWindow: () => mainWindow, isAllowedUrl: isAppUrl },
      getAppInfo,
      taskService: createTaskService({ repository: createTaskRepository(database) }),
      workspaceSettingsService: createWorkspaceSettingsService({
        repository: createSettingsRepository(database)
      }),
      flushRequester
    })
    showMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showMainWindow()
    })
  })

  // ⌘Q・メニューからの終了・app.quit()。保存完了の確認後に終了を再開する。
  app.on('before-quit', (event) => exitCoordinator.onQuitRequested(event))

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    if (database) {
      closeDatabase(database)
      database = null
      console.info('[db] closed')
    }
  })
}
