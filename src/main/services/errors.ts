import type { IpcErrorCode } from '../../shared/contracts/ipc'

// 業務上のエラー（予期しない障害とは区別する）。messageは画面表示用の短い文言とする。
// IPCハンドラーはこのエラーだけをcode・messageのままRendererへ返し、それ以外はINTERNALとして扱う。
export class BusinessError extends Error {
  readonly code: Extract<IpcErrorCode, 'NOT_FOUND'>

  constructor(code: Extract<IpcErrorCode, 'NOT_FOUND'>, message: string) {
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
