// IPCハンドラーの共通処理（送信元検証・入力検証・結果形式への変換）。
// electronをimportしないので、ホストNode.jsのテストから直接呼び出せる。
import type { z } from 'zod'
import type { IpcResult } from '../../shared/contracts/ipc'
import { BusinessError } from '../services/errors'

// IpcMainInvokeEvent / BrowserWindow のうち、検証に使う部分だけの型
export type InvokeEventLike = {
  sender: { id: number }
  senderFrame: { url: string; parent: unknown } | null
}

export type WindowLike = {
  isDestroyed(): boolean
  webContents: { id: number }
}

export type SenderPolicy = {
  getWindow: () => WindowLike | null
  isAllowedUrl: (url: string) => boolean
}

export type IpcLogger = Pick<Console, 'warn' | 'error'>

// 送信元が自アプリのウィンドウのメインフレームで、許可したURLかを確認する。
export function isTrustedSender(event: InvokeEventLike, policy: SenderPolicy): boolean {
  const win = policy.getWindow()
  const frame = event.senderFrame
  if (!win || win.isDestroyed() || !frame) return false
  if (event.sender.id !== win.webContents.id) return false
  if (frame.parent !== null) return false
  return policy.isAllowedUrl(frame.url)
}

export function createIpcHandler<S extends z.ZodType, T>(options: {
  channel: string
  argsSchema: S
  policy: SenderPolicy
  run: (args: z.infer<S>) => T | Promise<T>
  logger?: IpcLogger
}): (event: InvokeEventLike, ...rawArgs: unknown[]) => Promise<IpcResult<T>> {
  const { channel, argsSchema, policy, run } = options
  const logger = options.logger ?? console

  return async (event, ...rawArgs) => {
    if (!isTrustedSender(event, policy)) {
      logger.warn(`[ipc] 送信元を拒否しました: ${channel} ${event.senderFrame?.url ?? '(frameなし)'}`)
      return { ok: false, error: { code: 'FORBIDDEN', message: '許可されていない呼び出しです。' } }
    }

    const parsed = argsSchema.safeParse(rawArgs)
    if (!parsed.success) {
      logger.warn(`[ipc] 入力検証に失敗しました: ${channel}`, parsed.error.issues)
      const message = parsed.error.issues[0]?.message ?? '入力内容が正しくありません。'
      return { ok: false, error: { code: 'INVALID_INPUT', message } }
    }

    try {
      return { ok: true, data: await run(parsed.data) }
    } catch (error) {
      // 業務エラー（対象が存在しないなど）は、画面表示用のcode・messageだけを返す。
      if (error instanceof BusinessError) {
        logger.warn(`[ipc] ${channel}: ${error.code}`)
        // details は型付きの補足情報（ある場合だけ）。SQLやスタックは含まない
        return {
          ok: false,
          error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
        }
      }
      // 詳細（SQLやスタック）はMainのログだけに出し、Rendererへは返さない。
      logger.error(`[ipc] 処理中にエラーが発生しました: ${channel}`, error)
      return { ok: false, error: { code: 'INTERNAL', message: '処理中にエラーが発生しました。' } }
    }
  }
}
