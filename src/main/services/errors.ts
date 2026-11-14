import type { IpcErrorCode, IpcErrorDetails } from '../../shared/contracts/ipc'

export type BusinessErrorCode = Extract<IpcErrorCode, 'NOT_FOUND' | 'CONFLICT'>

// 業務上のエラー（予期しない障害とは区別する）。messageは画面表示用の短い文言とする。
// IPCハンドラーはこのエラーだけをcode・message（・details）のままRendererへ返し、それ以外はINTERNALとして扱う。
// details: 画面が使う型付きの補足情報（フェーズ5.3）。SQLやスタックは入れない。
export class BusinessError extends Error {
  readonly code: BusinessErrorCode
  readonly details: IpcErrorDetails | undefined

  constructor(code: BusinessErrorCode, message: string, details?: IpcErrorDetails) {
    super(message)
    this.name = 'BusinessError'
    this.code = code
    this.details = details
  }
}

export function taskNotFound(): BusinessError {
  return new BusinessError('NOT_FOUND', '対象のタスクが見つかりません。')
}

export function projectNotFound(): BusinessError {
  return new BusinessError('NOT_FOUND', '対象のプロジェクトが見つかりません。')
}

// タスクの作成・所属変更で指定したプロジェクトが存在しない（フェーズ5.2）
export function targetProjectNotFound(): BusinessError {
  return new BusinessError('NOT_FOUND', '指定したプロジェクトが見つかりません。')
}

// 完了済みのプロジェクトへの追加・移動（フェーズ5.2）
export function projectCompletedConflict(): BusinessError {
  return new BusinessError('CONFLICT', '完了済みのプロジェクトにはタスクを追加・移動できません。')
}

// 未完了のタスクがあるプロジェクトの完了（フェーズ5.3）。件数はDBの所属タスク全体から数えた値
export function projectHasOpenTasks(openTaskCount: number): BusinessError {
  return new BusinessError('CONFLICT', `未完了のタスクが${openTaskCount}件あるため完了できません。`, {
    kind: 'project-has-open-tasks',
    openTaskCount
  })
}

// 完了済みプロジェクトに所属するタスクを未完了に戻す（フェーズ5.3）
export function taskInCompletedProjectConflict(): BusinessError {
  return new BusinessError(
    'CONFLICT',
    '完了済みのプロジェクトのタスクは未完了に戻せません。先にプロジェクトを未完了に戻してください。'
  )
}

// マイルストン（フェーズ5.4）
export function milestoneNotFound(): BusinessError {
  return new BusinessError('NOT_FOUND', '対象のマイルストンが見つかりません。')
}

export function targetMilestoneNotFound(): BusinessError {
  return new BusinessError('NOT_FOUND', '指定したマイルストンが見つかりません。')
}

// 指定したマイルストンが、指定したプロジェクトに属していない
export function milestoneProjectMismatch(): BusinessError {
  return new BusinessError('CONFLICT', '指定したマイルストンは、そのプロジェクトに属していません。')
}

export function milestoneInCompletedProjectConflict(): BusinessError {
  return new BusinessError('CONFLICT', '完了済みのプロジェクトにはマイルストンを追加できません。')
}

// プロジェクトだけへの所属（マイルストンなし）。フェーズ5.6で廃止（入力検証でも拒否する）
export function milestoneRequired(): BusinessError {
  return new BusinessError('CONFLICT', 'プロジェクトに所属させる場合は、そのプロジェクトのマイルストンも指定してください。')
}

// 削除の確認後に対象（配下の件数）が変わった（フェーズ5.6）。削除範囲を無断で広げない
export function deletionScopeChanged(): BusinessError {
  return new BusinessError('CONFLICT', '確認した後に対象の件数が変わったため、削除しませんでした。内容を確認してください。', {
    kind: 'deletion-scope-changed'
  })
}

// --- フェーズ5.9: 一括操作・並べ替え ---

// 一括操作の対象の一部が存在しない・非表示（削除済みなど）。何も変更しない
export function someTasksNotFound(): BusinessError {
  return new BusinessError('NOT_FOUND', '選択したタスクの一部が見つかりません（削除された可能性があります）。何も変更していません。')
}

// Inboxからの一括紐付けで、対象の一部が既にInboxにない（別の操作で所属が変わった）。何も変更しない
export function tasksNotInInbox(): BusinessError {
  return new BusinessError('CONFLICT', '選択したタスクの一部は、既にInboxにありません。何も変更していません。')
}

// 並べ替えの対象が、DBの表示中のタスク・マイルストンと一致しない（画面の表示が古い・一部だけの指定）。何も変更しない
export function orderChanged(target: 'task' | 'milestone'): BusinessError {
  return new BusinessError(
    'CONFLICT',
    `${target === 'task' ? 'タスク' : 'マイルストン'}の一覧が更新されたため、並べ替えを保存しませんでした。もう一度操作してください。`,
    { kind: 'order-changed' }
  )
}
