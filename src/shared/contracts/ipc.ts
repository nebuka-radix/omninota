// IPC契約: 型とチャンネル名の定数だけを置く。実行時依存を持たない。
// Main / Preload / Rendererのどこからimportしてもよい。
import type { CreateTaskInput, SetTaskCompletedInput, TaskDto, UpdateTaskTitleInput } from './tasks'
import type { WorkspaceSettings } from './workspace'

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  tasksCreate: 'tasks:create',
  tasksList: 'tasks:list',
  tasksUpdateTitle: 'tasks:update-title',
  tasksSetCompleted: 'tasks:set-completed',
  workspaceGet: 'workspace:get',
  workspaceSave: 'workspace:save',
  // Main → Renderer: 終了・ウィンドウを閉じる前に、確定済みのWorkspace状態の保存完了を問い合わせる
  workspaceFlushRequest: 'workspace:flush-request',
  // Renderer → Main: 上記への応答
  workspaceFlushResult: 'workspace:flush-result'
} as const

// Rendererが返す保存結果
// - saved: 最新の確定値を保存できた / nothing: 未保存の変更なし
// - failed: 保存に失敗した / disabled: 起動時の読み込み失敗により保存を行わない設定
// - unsaved-draft: Workspace状態は保存済みだが、詳細パネルに未保存の編集（タイトル）がある（フェーズ4）
export const WORKSPACE_FLUSH_OUTCOMES = ['saved', 'nothing', 'failed', 'disabled', 'unsaved-draft'] as const
export type WorkspaceFlushOutcome = (typeof WORKSPACE_FLUSH_OUTCOMES)[number]

export type WorkspaceFlushResult = {
  requestId: string
  outcome: WorkspaceFlushOutcome
}

// NOT_FOUND: 業務エラー（対象が存在しない）。その他は送信元・入力・予期しない障害。
export type IpcErrorCode = 'FORBIDDEN' | 'INVALID_INPUT' | 'NOT_FOUND' | 'INTERNAL'

export type IpcError = {
  code: IpcErrorCode
  // 画面表示用の短いメッセージ。詳細はMain側のログへ出す。
  message: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

export type AppEnvironment = 'development' | 'production'

export type AppInfo = {
  name: string
  version: string
  environment: AppEnvironment
  userDataPath: string
  databasePath: string
  versions: {
    electron: string
    chrome: string
    node: string
  }
  platform: string
  arch: string
}

// Preloadがwindow.gtdとして公開するAPI
export type GtdApi = {
  app: {
    getInfo: () => Promise<IpcResult<AppInfo>>
  }
  tasks: {
    create: (input: CreateTaskInput) => Promise<IpcResult<TaskDto>>
    list: () => Promise<IpcResult<TaskDto[]>>
    // 用途別の更新API。任意の列は更新できない。成功時は保存後のタスクを返す。
    updateTitle: (input: UpdateTaskTitleInput) => Promise<IpcResult<TaskDto>>
    setCompleted: (input: SetTaskCompletedInput) => Promise<IpcResult<TaskDto>>
  }
  // Workspace設定専用。任意の設定キーは扱わない。
  workspace: {
    get: () => Promise<IpcResult<WorkspaceSettings>>
    save: (settings: WorkspaceSettings) => Promise<IpcResult<WorkspaceSettings>>
    // 終了前の保存問い合わせを購読する。戻り値は購読解除関数。
    onFlushRequest: (listener: (requestId: string) => void) => () => void
    reportFlushResult: (result: WorkspaceFlushResult) => Promise<IpcResult<null>>
  }
}
