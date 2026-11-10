import type { IpcErrorCode } from '../../shared/contracts/ipc'

export type BusinessErrorCode = Extract<IpcErrorCode, 'NOT_FOUND' | 'CONFLICT'>

// 業務上のエラー（予期しない障害とは区別する）。messageは画面表示用の短い文言とする。
// IPCハンドラーはこのエラーだけをcode・messageのままRendererへ返し、それ以外はINTERNALとして扱う。
export class BusinessError extends Error {
  readonly code: BusinessErrorCode

  constructor(code: BusinessErrorCode, message: string) {
    super(message)
    this.name = 'BusinessError'
    this.code = code
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
