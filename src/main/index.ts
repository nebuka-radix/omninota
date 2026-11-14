import { readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createWindowState } from './lifecycle/window-state'
import { app, BrowserWindow, dialog, screen, session, systemPreferences } from 'electron'
import { enableNativeKeyRepeat } from './infrastructure/key-repeat'
import { APP_IDENTITY } from '../shared/app-identity'
import { IPC_CHANNELS, type AppInfo } from '../shared/contracts/ipc'
import { closeDatabase, openDatabase, type AppDatabase } from './db/client'
import { runMigrations } from './db/migrate'
import { createTransactionRunner } from './db/transaction'
import { resolveDatabaseFile, resolveMigrationsDir, resolveUserDataDir } from './infrastructure/app-paths'
import { fitWindowBounds, resolveTestMode, selectTestDisplay } from './infrastructure/test-mode'
import { registerIpcHandlers } from './ipc'
import { registerTaskImportantHandler } from './ipc/task-important'
import { createTaskImportantService } from './services/task-important-service'
import { createTaskImportantRepository } from './repositories/task-important-repository'
import {
  createExitCoordinator,
  createFlushRequester,
  type ExitKind,
  type FailureChoice,
  type FlushCheckOutcome,
  unsavedDraftDialogText
} from './lifecycle/workspace-flush'
import { createScriptedMessageBox, type MessageBoxAdapter } from './lifecycle/message-box'
import { watchParentProcess, type ParentWatcher } from './lifecycle/parent-watch'
import { createMilestoneRepository } from './repositories/milestone-repository'
import { createProjectRepository } from './repositories/project-repository'
import { createNoteRepository } from './repositories/note-repository'
import { createNoteService } from './services/note-service'
import { createSettingsRepository } from './repositories/settings-repository'
import { createTaskRepository } from './repositories/task-repository'
import { createMilestoneService } from './services/milestone-service'
import { createProjectService } from './services/project-service'
import { createSummaryService } from './services/summary-service'
import { createTaskService } from './services/task-service'
import { createWorkspaceSettingsService } from './services/workspace-settings-service'
import {
  createMainWindow,
  DEFAULT_WINDOW_SIZE,
  isAppUrl,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  type WindowPresentation
} from './window'

// Use native macOS key repeat instead of the press-and-hold accent picker.
enableNativeKeyRepeat(process.platform, systemPreferences)

// 自動テスト用の起動モード（GTD_TEST_UI=hidden / secondary）。未パッケージ時だけ有効。
// 詳細は docs/testing.md。通常起動・パッケージ版の動作は変えない。
const testMode = resolveTestMode({
  env: process.env,
  isPackaged: app.isPackaged,
  tempRoots: [...new Set([tmpdir(), realpathSync(tmpdir()), '/tmp', '/private/tmp'])]
})
if (testMode.kind === 'error') {
  // 設定の誤りでは、userDataを決める前にすぐ終了する（ウィンドウ・ダイアログを出さず、開発・通常利用のディレクトリにも触れない）
  console.error(`[test] テストモードを開始できません: ${testMode.reason}`)
  process.exit(2)
}
if (testMode.kind === 'off' && testMode.ignoredInPackagedApp) {
  console.warn('[test] パッケージ版のため GTD_TEST_UI を無視します')
}
// userDataはreadyより前に確定させる。開発・previewは GTD-dev、パッケージ版は GTD。
app.setName(APP_IDENTITY.displayName)

app.setPath(
  'userData',
  resolveUserDataDir({
    isPackaged: app.isPackaged,
    appDataDir: app.getPath('appData'),
    // 検証用（未パッケージ時だけ有効）。大量データの確認などで、開発用DBを汚さずに一時DBを使う。
    devOverrideDir: process.env['GTD_DEV_USER_DATA_DIR']
  })
)

const testConfig = testMode.kind === 'on' ? testMode.config : null
if (testConfig) {
  console.info(`[test] テストモード: ${testConfig.mode}（userData: ${app.getPath('userData')}）`)
  // Dockに表示せず、起動時にアプリを前面化しない（ユーザーの作業中アプリからフォーカスを奪わない）
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
  // 自動テストだけ: ウィンドウの×と同じ経路（BrowserWindow.close → close イベント）で閉じる要求を出す（フェーズ5.9）。
  // 非表示のウィンドウには×ボタンを押せないため、テストの実行スクリプトがこのプロセスへ SIGUSR2 を送って使う。通常起動では登録しない
  process.on('SIGUSR2', () => {
    console.info('[test] ウィンドウを閉じる要求（×と同じ経路）')
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
  })
}

// 現在時刻（フェーズ6: 「今日」「明日」・Summary Review の期間の基準）。
// 自動テストだけ（テストモード・未パッケージ）、GTD_TEST_CLOCK_FILE のJSON（{ at: ISO日時, setAt: 書き込んだ時のミリ秒 }）で
// 現在時刻をずらせる（日付の切り替え・ローカル日付とUTC日付が異なる時刻の検証用。経過時間はそのまま進む）。ファイルがなければ実際の時刻。
const clockFile = testConfig ? process.env['GTD_TEST_CLOCK_FILE'] : undefined
function now(): Date {
  if (!clockFile) return new Date()
  try {
    const { at, setAt } = JSON.parse(readFileSync(clockFile, 'utf8')) as { at: string; setAt: number }
    const base = Date.parse(at)
    if (Number.isNaN(base) || typeof setAt !== 'number') return new Date()
    return new Date(base + (Date.now() - setAt))
  } catch {
    return new Date()
  }
}

// ネイティブダイアログ。テストモードでは画面に出さず、指定した回答を使う。
const messageBox: MessageBoxAdapter = testConfig
  ? createScriptedMessageBox(testConfig.dialogAnswers)
  : {
      show: async (request) => {
        const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
        return (parent ? await dialog.showMessageBox(parent, request) : await dialog.showMessageBox(request)).response
      },
      showError: (title, content) => dialog.showErrorBox(title, content)
    }

// ウィンドウの表示方法（secondaryの表示先は ready 後に決める）
let windowPresentation: WindowPresentation = { kind: testConfig?.mode === 'hidden' ? 'hidden' : 'normal' }

const databaseFile = resolveDatabaseFile(app.getPath('userData'))
const migrationsDir = resolveMigrationsDir({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath
})

let windowState: ReturnType<typeof createWindowState> | null = null
let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null

// 終了・ウィンドウを閉じる前に、Rendererへ確定済みWorkspace状態と未保存ドラフトの扱いを問い合わせる。
// 破棄済みのウィンドウ・Rendererには送らない（unavailableとして扱う）。
const flushRequester = createFlushRequester({
  send: (request) => {
    const win = mainWindow
    if (!win || win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isCrashed()) return false
    win.webContents.send(IPC_CHANNELS.workspaceFlushRequest, request)
    return true
  }
})

// 終了フローのダイアログ（同時に1つだけ。ExitCoordinatorが順番に呼ぶ）
async function askOnFlushFailure(outcome: FlushCheckOutcome, kind: ExitKind): Promise<FailureChoice> {
  const show = messageBox.show
  const verb = kind === 'quit' ? '終了' : '閉じる'
  console.warn(`[exit] 確認ダイアログを表示します（${outcome}）`)

  // 未保存の編集（タスクのタイトル・プロジェクト名）がある場合
  if (outcome === 'unsaved-draft') {
    const text = unsavedDraftDialogText(flushRequester.lastDraftKind(), kind)
    const response = await show({
      type: 'warning',
      buttons: text.buttons,
      defaultId: 0,
      cancelId: 2,
      message: text.message,
      detail: text.detail
    })
    return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'
  }

  const reason =
    outcome === 'timeout' ? '画面からの応答がありませんでした。' : 'UI設定（ペイン幅など）の保存に失敗しました。'
  const response = await show({
    type: 'warning',
    buttons: ['再試行', `保存せずに${verb}`, 'キャンセル'],
    defaultId: 0,
    cancelId: 2,
    message: 'UI設定を保存できませんでした',
    detail: `${reason}\nタスクのデータには影響しません。`
  })
  return response === 0 ? 'retry' : response === 1 ? 'discard' : 'cancel'
}

// フェーズ5.9: ウィンドウは1つだけのため、×（最後のウィンドウを閉じる）は macOS でもアプリの終了要求として扱う。
// ×・⌘Q・SIGINT/SIGHUP/SIGTERM（開発起動の Ctrl+C など。handleShutdownSignals で app.quit() として扱う）は、すべて同じ保存確認を通ってから終了する。
// 確認でキャンセルした場合は、ウィンドウもアプリ（開発起動では開発サーバーも）そのまま残る。
const exitCoordinator = createExitCoordinator({
  requestFlush: (draftAction) => flushRequester.request(draftAction),
  askOnFailure: askOnFlushFailure,
  continueQuit: () => app.quit(),
  continueClose: () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
  },
  closeQuitsApp: true
})

// 開発起動（electron-vite の開発サーバーを使う未パッケージの起動）だけ、親プロセス（electron-vite）の終了を監視する。
// 親が先に終了した（強制終了など）場合も、通常の終了フロー（保存確認）を通って終了し、Electron を取り残さない。
// Ctrl+C（SIGINT）・端末を閉じた時（SIGHUP）・SIGTERM を、即終了せずに通常の終了要求（app.quit → 保存確認）として扱う（フェーズ5.9）。
// Electron（Chromium）の既定の処理は、1回目で終了を始め、2回目を受けると確認を待たずに即時終了する。開発起動の Ctrl+C では
// 端末からの SIGINT と electron-vite が転送する SIGINT の2回が届くため、保存確認・DBを閉じる処理を通らずに終了していた。
// Chromium が自分の処理を登録した後（ready 後）に登録し直して置き換える。何回届いても ExitCoordinator が確認を1回にまとめる。
// 確認でキャンセルされればアプリ（と開発環境）は残る。
function handleShutdownSignals(): void {
  for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.info(`[exit] ${signal} を受け取りました。終了の確認を行います`)
      app.quit()
    })
  }
}

let parentWatcher: ParentWatcher | null = null
function startParentWatch(): void {
  if (app.isPackaged || !process.env['ELECTRON_RENDERER_URL']) return
  parentWatcher = watchParentProcess({
    getParentPid: () => process.ppid,
    onOrphaned: ({ initialParentPid, currentParentPid }) => {
      console.warn(`[exit] 開発起動の親プロセス（${initialParentPid}）が終了したため、アプリを終了します（現在の親: ${currentParentPid}）`)
      app.quit()
    }
  })
  console.info(`[exit] 開発起動の親プロセス（${process.ppid}）の終了を監視します`)
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    exitCoordinator.resetForNewWindow()
    if (!database) throw new Error('DBが初期化されていません')
    windowState ??= createWindowState(createSettingsRepository(database), MIN_WINDOW_WIDTH)
    const restoring = windowPresentation.kind === 'normal'
    mainWindow = createMainWindow(windowPresentation, restoring ? { compact: windowState.compact, bounds: windowState.restoreBounds() } : undefined)
    // 自動UIテストでは従来の起動サイズと表示方法を維持する。
    if (restoring) windowState.attach(mainWindow)
    if (testConfig) {
      // 実行スクリプトが「表示されていない」「フォーカスを取っていない」「表示位置」を確認するためのログ
      const win = mainWindow
      win.on('show', () => console.info(`[test] window-show bounds=${JSON.stringify(win.getBounds())}`))
      win.on('focus', () => console.info('[test] window-focus'))
    }
    // ×で閉じる要求は、保存完了を確認してからアプリの終了として扱う（フェーズ5.9。以前は macOS ではアプリを残していた）
    mainWindow.on('close', (event) => exitCoordinator.onWindowCloseRequested(event))
    mainWindow.on('closed', () => {
      mainWindow = null
    })
    return
  }
  // テストモードでは、2つ目の起動・Dockのクリックなどでも勝手に表示・前面化しない
  if (testConfig) {
    console.info('[test] 既存ウィンドウの表示・フォーカスは行いません')
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
    compact: windowPresentation.kind === 'normal' ? windowState?.compact ?? false : false,
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

// secondary の表示先（ready後に呼ぶ）。決められなければ表示せずに理由を返す。
function resolveSecondaryPresentation(): WindowPresentation | string {
  const selected = selectTestDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay().id, testConfig?.displayId ?? null)
  if (!selected.ok) return selected.reason
  const fitted = fitWindowBounds(selected.display.workArea, DEFAULT_WINDOW_SIZE, {
    width: MIN_WINDOW_WIDTH,
    height: MIN_WINDOW_HEIGHT
  })
  if (!fitted.ok) return fitted.reason
  console.info(
    `[test] 表示先ディスプレイ: ${selected.display.id} workArea=${JSON.stringify(selected.display.workArea)} bounds=${JSON.stringify(fitted.bounds)}`
  )
  return { kind: 'inactive', bounds: fitted.bounds }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  void app.whenReady().then(() => {
    if (testConfig?.mode === 'secondary') {
      const presentation = resolveSecondaryPresentation()
      if (typeof presentation === 'string') {
        // プライマリへ黙って表示しない。DBを開く前に終了する
        console.error(`[test] secondary で表示できないため終了します: ${presentation}`)
        app.exit(3)
        return
      }
      windowPresentation = presentation
    }
    applySecurityPolicies()
    console.info(`[app] userData: ${app.getPath('userData')} (packaged: ${app.isPackaged})`)

    try {
      database = initializeDatabase()
    } catch (error) {
      console.error('[db] データベースの初期化に失敗しました', error)
      messageBox.showError(
        'データベースを開けませんでした',
        `データは削除・初期化していません。\n\n保存先: ${databaseFile}\n\n` +
          (error instanceof Error ? error.message : String(error))
      )
      app.exit(1)
      return
    }

    // マイグレーション完了後にIPC（タスクAPI）を登録する。
    const projectRepository = createProjectRepository(database)
    const taskRepository = createTaskRepository(database)
    const transaction = createTransactionRunner(database)
    const milestoneRepository = createMilestoneRepository(database)
    registerTaskImportantHandler({
      policy: { getWindow: () => mainWindow, isAllowedUrl: isAppUrl },
      service: createTaskImportantService({ repository: createTaskImportantRepository(database), transaction, now })
    })
    registerIpcHandlers({
      policy: { getWindow: () => mainWindow, isAllowedUrl: isAppUrl },
      getAppInfo,
    setCompact: (compact) => {
      if (windowPresentation.kind !== 'normal') {
        if (!mainWindow || mainWindow.isDestroyed()) throw new Error('ウィンドウがありません')
        mainWindow.setMinimumSize(compact ? 240 : MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
      } else {
        if (!windowState) throw new Error('ウィンドウ設定が初期化されていません')
        windowState.setCompact(compact)
      }
      return null
    },
      noteService: createNoteService({ repository: createNoteRepository(database), settings: createSettingsRepository(database), now }),
      taskService: createTaskService({
        repository: taskRepository,
        findProject: projectRepository.findById,
        findMilestone: milestoneRepository.findById,
        transaction,
        now
      }),
      summaryService: createSummaryService({ listDueOnOrBefore: taskRepository.listDueOnOrBefore, now }),
      milestoneService: createMilestoneService({
        repository: milestoneRepository,
        findProject: projectRepository.findById,
        countTasks: taskRepository.countByMilestone,
        hideTasks: taskRepository.hideByMilestone,
        transaction
      }),
      projectService: createProjectService({
        repository: projectRepository,
        countOpenTasks: taskRepository.countOpenByProject,
        insertMilestone: milestoneRepository.insert,
        countMilestones: milestoneRepository.countByProject,
        detachMilestones: milestoneRepository.detachByProject,
        countTasks: taskRepository.countByProject,
        detachAndHideTasks: taskRepository.detachAndHideByProject,
        transaction
      }),
      workspaceSettingsService: createWorkspaceSettingsService({
        repository: createSettingsRepository(database)
      }),
      flushRequester
    })
    showMainWindow()
    startParentWatch()
    handleShutdownSignals()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showMainWindow()
    })
  })

  // ⌘Q・メニューからの終了・app.quit()。保存完了の確認後に終了を再開する。
  app.on('before-quit', (event) => exitCoordinator.onQuitRequested(event))

  // 最後のウィンドウが閉じたら、macOS でも終了する（フェーズ5.9。保存確認は閉じる前に済んでいる）
  app.on('window-all-closed', () => app.quit())

  app.on('will-quit', () => {
    parentWatcher?.stop()
    parentWatcher = null
    if (database) {
      closeDatabase(database)
      database = null
      console.info('[db] closed')
    }
  })
}
