// IPC契約: 型とチャンネル名の定数だけを置く。実行時依存を持たない。
// Main / Preload / Rendererのどこからimportしてもよい。
import type {
  CreateProjectInput,
  DeleteProjectInput,
  DeleteProjectResult,
  ProjectDeletionSummary,
  ProjectDto,
  RenameProjectInput,
  SetProjectCompletedInput,
  SetProjectFavoriteInput
} from './projects'
import type {
  CreateMilestoneInput,
  DeleteMilestoneInput,
  DeleteMilestoneResult,
  MilestoneDeletionSummary,
  MilestoneDto,
  RenameMilestoneInput,
  ReorderMilestonesInput,
  SetMilestoneFavoriteInput
} from './milestones'
import type {
  AssignInboxTasksInput,
  CreateTaskInput,
  DeleteTaskInput,
  DeleteTaskResult,
  DeleteTasksInput,
  DeleteTasksResult,
  ReorderMilestoneTasksInput,
  SetTaskDueInput,
  SetTasksDayInput,
  SetTaskFavoriteInput,
  SetTaskImportantInput,
  SetTaskAssignmentInput,
  SetTaskCompletedInput,
  TaskDto,
  UpdateTaskTitleInput
} from './tasks'
import type { SummaryReview } from './summary'
import type { WorkspaceSettings } from './workspace'
import type { NoteDto, SaveNoteInput, RenameNoteInput, FavoriteNoteInput } from './notes'

export const IPC_CHANNELS = {
  notesList: 'notes:list',
  notesCreate: 'notes:create',
  notesSave: 'notes:save',
  notesRename: 'notes:rename',
  notesSetFavorite: 'notes:set-favorite',
  notesGetSidebarWidth: 'notes:get-sidebar-width',
  notesSaveSidebarWidth: 'notes:save-sidebar-width',
  appGetInfo: 'app:get-info',
  appSetCompact: 'app:set-compact',
  tasksCreate: 'tasks:create',
  tasksList: 'tasks:list',
  tasksUpdateTitle: 'tasks:update-title',
  tasksSetCompleted: 'tasks:set-completed',
  tasksSetAssignment: 'tasks:set-assignment',
  tasksDelete: 'tasks:delete',
  tasksAssignFromInbox: 'tasks:assign-from-inbox',
  tasksDeleteMany: 'tasks:delete-many',
  tasksReorderInMilestone: 'tasks:reorder-in-milestone',
  tasksSetDue: 'tasks:set-due',
  tasksSetDayMany: 'tasks:set-day-many',
  tasksSetFavorite: 'tasks:set-favorite',
  tasksSetImportant: 'tasks:set-important',
  summaryGet: 'summary:get',
  summaryToday: 'summary:today',
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsRename: 'projects:rename',
  projectsSetCompleted: 'projects:set-completed',
  projectsSetFavorite: 'projects:set-favorite',
  projectsGetDeletionSummary: 'projects:get-deletion-summary',
  projectsDelete: 'projects:delete',
  milestonesList: 'milestones:list',
  milestonesCreate: 'milestones:create',
  milestonesRename: 'milestones:rename',
  milestonesSetFavorite: 'milestones:set-favorite',
  milestonesGetDeletionSummary: 'milestones:get-deletion-summary',
  milestonesDelete: 'milestones:delete',
  milestonesReorder: 'milestones:reorder',
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
export const DRAFT_KINDS = ['task', 'project', 'milestone', 'note'] as const
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
// - deletion-scope-changed: 確認した後に削除の対象（配下の件数）が変わったため削除しなかった（CONFLICT。フェーズ5.6）。
//   画面は確認内容を取り直して再確認する（無断で削除範囲を広げない）
// - order-changed: 並べ替えの対象（マイルストンのタスク・プロジェクトのマイルストン）が画面の表示と一致しないため保存しなかった
//   （CONFLICT。フェーズ5.9）。画面は一覧を取り直す（一部だけの順位で、表示していない対象の順位を壊さない）
export type IpcErrorDetails =
  | { kind: 'project-has-open-tasks'; openTaskCount: number }
  | { kind: 'deletion-scope-changed' }
  | { kind: 'order-changed' }

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
  compact?: boolean
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
  notes: {
    list: () => Promise<IpcResult<NoteDto[]>>
    create: () => Promise<IpcResult<NoteDto>>
    save: (input: SaveNoteInput) => Promise<IpcResult<NoteDto>>
    rename: (input: RenameNoteInput) => Promise<IpcResult<NoteDto>>
    setFavorite: (input: FavoriteNoteInput) => Promise<IpcResult<NoteDto>>
    getSidebarWidth: () => Promise<IpcResult<number>>
    saveSidebarWidth: (width: number) => Promise<IpcResult<number>>
  }
  app: {
    getInfo: () => Promise<IpcResult<AppInfo>>
    setCompact: (compact: boolean) => Promise<IpcResult<null>>
  }
  tasks: {
    create: (input: CreateTaskInput) => Promise<IpcResult<TaskDto>>
    list: () => Promise<IpcResult<TaskDto[]>>
    // 用途別の更新API。任意の列は更新できない。成功時は保存後のタスクを返す。
    updateTitle: (input: UpdateTaskTitleInput) => Promise<IpcResult<TaskDto>>
    setCompleted: (input: SetTaskCompletedInput) => Promise<IpcResult<TaskDto>>
    // 所属（プロジェクト・マイルストン）の変更・解除を1回で保存する（フェーズ5.4。5.2の setProject を置き換え）
    setAssignment: (input: SetTaskAssignmentInput) => Promise<IpcResult<TaskDto>>
    // 表示中のタスクの物理削除（フェーズ5.6）。非表示・存在しないタスクは NOT_FOUND
    delete: (input: DeleteTaskInput) => Promise<IpcResult<DeleteTaskResult>>
    // Inboxの複数タスクを1つのマイルストンへまとめて紐付ける（フェーズ5.9）。1つのトランザクションで、全件成功か全件不変
    assignFromInbox: (input: AssignInboxTasksInput) => Promise<IpcResult<TaskDto[]>>
    // 表示中の複数タスクの物理削除（フェーズ5.9）。1つのトランザクションで、全件削除か全件不変
    deleteMany: (input: DeleteTasksInput) => Promise<IpcResult<DeleteTasksResult>>
    // マイルストン内のタスクの手動順を保存する（フェーズ5.9）。そのマイルストンの表示中のタスク全件を返す
    reorderInMilestone: (input: ReorderMilestoneTasksInput) => Promise<IpcResult<TaskDto[]>>
    // 期限の設定・変更・解除（フェーズ6）。期限だけを更新し、保存後のタスクを返す
    setDue: (input: SetTaskDueInput) => Promise<IpcResult<TaskDto>>
    setDayMany: (input: SetTasksDayInput) => Promise<IpcResult<TaskDto[]>>
    // お気に入りの設定・解除。お気に入りだけを更新し、保存後のタスクを返す
    setFavorite: (input: SetTaskFavoriteInput) => Promise<IpcResult<TaskDto>>
    setImportant: (input: SetTaskImportantInput) => Promise<IpcResult<TaskDto>>
  }
  // Summary Review（フェーズ6）。条件は Main で適用し、該当するタスクだけを返す
  summary: {
    get: () => Promise<IpcResult<SummaryReview>>
    // Main のローカルの今日（"YYYY-MM-DD"）。期限の表示に使う（保存の「今日」「明日」と同じ日付）
    today: () => Promise<IpcResult<string>>
  }
  // 用途別のAPI（一覧・作成・名前変更はフェーズ5.1、完了・取り消しは5.3）
  projects: {
    list: () => Promise<IpcResult<ProjectDto[]>>
    create: (input: CreateProjectInput) => Promise<IpcResult<ProjectDto>>
    rename: (input: RenameProjectInput) => Promise<IpcResult<ProjectDto>>
    // 完了・完了の取り消し（フェーズ5.3）。未完了のタスクがあれば CONFLICT（details: project-has-open-tasks）
    setCompleted: (input: SetProjectCompletedInput) => Promise<IpcResult<ProjectDto>>
    setFavorite: (input: SetProjectFavoriteInput) => Promise<IpcResult<ProjectDto>>
    // 削除（フェーズ5.6）。確認内容（件数）を取得してから、その件数を添えて削除する。
    // 配下のマイルストン・タスクは削除せず、所属を外して非表示にする（Inboxにも表示しない）
    getDeletionSummary: (input: { id: string }) => Promise<IpcResult<ProjectDeletionSummary>>
    delete: (input: DeleteProjectInput) => Promise<IpcResult<DeleteProjectResult>>
  }
  // マイルストン（フェーズ5.4）。一覧は全プロジェクト分（少量）。完了はない。並べ替えはフェーズ5.9から
  milestones: {
    list: () => Promise<IpcResult<MilestoneDto[]>>
    create: (input: CreateMilestoneInput) => Promise<IpcResult<MilestoneDto>>
    rename: (input: RenameMilestoneInput) => Promise<IpcResult<MilestoneDto>>
    setFavorite: (input: SetMilestoneFavoriteInput) => Promise<IpcResult<MilestoneDto>>
    // 削除（フェーズ5.6）。所属タスクは削除せず、所属を外して非表示にする
    getDeletionSummary: (input: { id: string }) => Promise<IpcResult<MilestoneDeletionSummary>>
    delete: (input: DeleteMilestoneInput) => Promise<IpcResult<DeleteMilestoneResult>>
    // カードの順序を保存する（フェーズ5.9）。そのプロジェクトの表示中のマイルストン全件を返す
    reorder: (input: ReorderMilestonesInput) => Promise<IpcResult<MilestoneDto[]>>
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
