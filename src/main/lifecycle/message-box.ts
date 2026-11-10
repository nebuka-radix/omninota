// Mainのネイティブダイアログ呼び出しを分離する小さなアダプター。electronをimportしない。
// - 通常起動・パッケージ版: Electronの dialog を使う実装（src/main/index.ts で作る）
// - 自動テスト（GTD_TEST_UI）: 起動時に指定した回答を順番に使う実装（画面にダイアログを出さない）
import type { DialogAnswer } from '../infrastructure/test-mode'

export type MessageBoxRequest = {
  type: 'warning' | 'error' | 'info'
  message: string
  detail?: string
  buttons: string[]
  defaultId: number
  cancelId: number
}

export type MessageBoxAdapter = {
  // 押されたボタンの番号
  show(request: MessageBoxRequest): Promise<number>
  // 起動失敗などの通知（ボタンの選択なし）
  showError(title: string, content: string): void
}

// テスト用。回答が未指定・ボタンが見つからない・見出しが違う場合は、保存も破棄も選ばずにキャンセル（cancelId）を返し、
// 失敗として記録する（ログの "[test-dialog] FAIL" を実行スクリプトが検出してテストを失敗にする）。
export function createScriptedMessageBox(
  answers: readonly DialogAnswer[],
  logger: Pick<Console, 'info' | 'error'> = console
): MessageBoxAdapter & { failures(): string[] } {
  const queue = [...answers]
  const failures: string[] = []
  const fail = (reason: string, request: MessageBoxRequest) => {
    const text = `${reason}: ${JSON.stringify({ message: request.message, buttons: request.buttons })}`
    failures.push(text)
    logger.error(`[test-dialog] FAIL ${text}`)
    return request.cancelId
  }
  return {
    async show(request) {
      const answer = queue.shift()
      if (!answer) return fail('ダイアログへの回答が指定されていません', request)
      if (answer.message !== undefined && answer.message !== request.message) {
        return fail(`想定と異なるダイアログです（想定: ${answer.message}）`, request)
      }
      const index = request.buttons.indexOf(answer.button)
      if (index < 0) return fail(`ボタン「${answer.button}」がありません`, request)
      logger.info(`[test-dialog] ${JSON.stringify({ message: request.message, buttons: request.buttons, chosen: answer.button })}`)
      return index
    },
    showError(title, content) {
      logger.error(`[test-dialog] error-box ${JSON.stringify({ title, content })}`)
    },
    failures: () => [...failures]
  }
}
