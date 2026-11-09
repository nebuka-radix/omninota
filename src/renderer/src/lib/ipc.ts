import type { IpcErrorCode, IpcResult } from '../../../shared/contracts/ipc'

// IPCの失敗結果をQueryが扱える例外へ変換する。
export class IpcCallError extends Error {
  readonly code: IpcErrorCode

  constructor(code: IpcErrorCode, message: string) {
    super(message)
    this.name = 'IpcCallError'
    this.code = code
  }
}

export async function unwrapIpc<T>(call: Promise<IpcResult<T>>): Promise<T> {
  const result = await call
  if (!result.ok) {
    throw new IpcCallError(result.error.code, result.error.message)
  }
  return result.data
}
