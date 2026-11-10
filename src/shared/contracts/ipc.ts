// IPC契約: 型とチャンネル名の定数だけを置く。実行時依存を持たない。
// Main / Preload / Rendererのどこからimportしてもよい。
import type { CreateProjectInput, ProjectDto, RenameProjectInput, SetProjectCompletedInput } from './projects'
import type { CreateTaskInput, SetTaskCompletedInput, SetTaskProjectInput, TaskDto, UpdateTaskTitleInput } from './tasks'
import type { WorkspaceSettings } from './workspace'

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  tasksCreate: 'tasks:create',
  tasksList: 'tasks:list',
  tasksUpdateTitle: 'tasks:update-title',
  tasksSetCompleted: 'tasks:set-completed',
  tasksSetProject: 'tasks:set-project',
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsRename: 'projects:rename',
  projectsSetCompleted: 'projects:set-completed',
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
// - draft-save-failed: 「保存して終了」でタイトルを保存できなかった（無効な入力を含む）。ドラフトは残している（フェーズ4.1）
export const WORKSPACE_FLUSH_OUTCOMES = ['saved', 'nothing', 'failed', 'disabled', 'unsaved-draft', 'draft-save-failed'] as const
export type WorkspaceFlushOutcome = (typeof WORKSPACE_FLUSH_OUTCOMES)[number]

// 終了前の問い合わせで、未保存のドラフトをどう扱うか（フェーズ4.1）
// - check: 確認だけ（ドラフトは変えない） / save: ドラフトを保存してから応答 / discard: ドラフトを破棄してから応答
export const DRAFT_EXIT_ACTIONS = ['check', 'save', 'discard'] as const
export type DraftExitAction = (typeof DRAFT_EXIT_ACTIONS)[number]

export type WorkspaceFlushRequest = {
  requestId: string
  draftAction: DraftExitAction
}

// 未保存ドラフトの対象（終了時のダイアログの文言に使う。フェーズ5.1）
export const DRAFT_KINDS = ['task', 'project'] as const
export type DraftKind = (typeof DRAFT_KINDS)[number]

export type WorkspaceFlushResult = {
  requestId: string
  outcome: WorkspaceFlushOutcome
  // outcome が unsaved-draft / draft-save-failed の時の対象
  draftKind?: DraftKind
}

// 業務エラー: NOT_FOUND（対象が存在しない）、CONFLICT（業務ルールにより実行できない。完了済みプロジェクトへの追加など。フェーズ5.2）。
// その他は送信元・入力・予期しない障害。
export type IpcErrorCode = 'FORBIDDEN' | 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL'

// 業務エラーの型付きの補足情報（フェーズ5.3）。画面はメッセージ文字列を解析せず、この値を使う。
// - project-has-open-tasks: プロジェクトに未完了のタスクがあるため完了できない（CONFLICT）。件数はDBの所属タスク全体から数える
export type IpcErrorDetails = { kind: 'project-has-open-tasks'; openTaskCount: number }

export type IpcError = {
  code: IpcErrorCode
  // 画面表示用の短いメッセージ。詳細はMain側のログへ出す。
  message: string
  // 業務エラーの補足（ある場合だけ）。SQLやスタックは含めない
  details?: IpcErrorDetails
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
    // 所属の変更・解除（フェーズ5.2）
    setProject: (input: SetTaskProjectInput) => Promise<IpcResult<TaskDto>>
  }
  // 用途別のAPI（一覧・作成・名前変更はフェーズ5.1、完了・取り消しは5.3）
  projects: {
    list: () => Promise<IpcResult<ProjectDto[]>>
    create: (input: CreateProjectInput) => Promise<IpcResult<ProjectDto>>
    rename: (input: RenameProjectInput) => Promise<IpcResult<ProjectDto>>
    // 完了・完了の取り消し（フェーズ5.3）。未完了のタスクがあれば CONFLICT（details: project-has-open-tasks）
    setCompleted: (input: SetProjectCompletedInput) => Promise<IpcResult<ProjectDto>>
  }
  // Workspace設定専用。任意の設定キーは扱わない。
  workspace: {
    get: () => Promise<IpcResult<WorkspaceSettings>>
    save: (settings: WorkspaceSettings) => Promise<IpcResult<WorkspaceSettings>>
    // 終了前の保存問い合わせを購読する。戻り値は購読解除関数。
    onFlushRequest: (listener: (request: WorkspaceFlushRequest) => void) => () => void
    reportFlushResult: (result: WorkspaceFlushResult) => Promise<IpcResult<null>>
  }
}
