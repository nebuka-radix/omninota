import type { IpcErrorCode, IpcErrorDetails, IpcResult } from '../../../shared/contracts/ipc'

// IPCの失敗結果をQueryが扱える例外へ変換する。
export class IpcCallError extends Error {
  readonly code: IpcErrorCode
  // 業務エラーの型付きの補足（フェーズ5.3）。画面はメッセージ文字列を解析せずにこれを使う
  readonly details: IpcErrorDetails | undefined

  constructor(code: IpcErrorCode, message: string, details?: IpcErrorDetails) {
    super(message)
    this.name = 'IpcCallError'
    this.code = code
    this.details = details
  }
}

export async function unwrapIpc<T>(call: Promise<IpcResult<T>>): Promise<T> {
  const result = await call
  if (!result.ok) {
    throw new IpcCallError(result.error.code, result.error.message, result.error.details)
  }
  return result.data
}
