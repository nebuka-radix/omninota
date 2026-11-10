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
