import { describe, expect, it, vi } from 'vitest'
import { fitWindowBounds, resolveTestMode, selectTestDisplay } from '../../src/main/infrastructure/test-mode'
import { createScriptedMessageBox, type MessageBoxRequest } from '../../src/main/lifecycle/message-box'

const TMP = '/var/folders/xx/T'
const resolve = (env: Record<string, string | undefined>, isPackaged = false) =>
  resolveTestMode({ env, isPackaged, tempRoots: [TMP, '/private/tmp'] })
const base = { GTD_TEST_UI: 'hidden', GTD_DEV_USER_DATA_DIR: `${TMP}/gtd-ui-test-1/userData` }

describe('テストモードの判定（GTD_TEST_UI）', () => {
  it('未指定なら無効（通常起動）', () => {
    expect(resolve({})).toEqual({ kind: 'off', ignoredInPackagedApp: false })
    expect(resolve({ GTD_TEST_UI: '' })).toEqual({ kind: 'off', ignoredInPackagedApp: false })
  })

  it('パッケージ版では指定されても無視する', () => {
    expect(resolve(base, true)).toEqual({ kind: 'off', ignoredInPackagedApp: true })
  })

  it('hidden / secondary と一時userDataの組み合わせで有効', () => {
    expect(resolve(base)).toEqual({ kind: 'on', config: { mode: 'hidden', displayId: null, dialogAnswers: [] } })
    expect(resolve({ ...base, GTD_TEST_UI: 'secondary', GTD_TEST_DISPLAY_ID: '724063890' })).toEqual({
      kind: 'on',
      config: { mode: 'secondary', displayId: 724063890, dialogAnswers: [] }
    })
  })

  it.each<[string, Record<string, string | undefined>]>([
    ['未知のモード', { ...base, GTD_TEST_UI: 'headless' }],
    ['userDataなし', { GTD_TEST_UI: 'hidden' }],
    ['相対パス', { ...base, GTD_DEV_USER_DATA_DIR: 'tmp/x' }],
    ['一時ディレクトリの外（開発DB）', { ...base, GTD_DEV_USER_DATA_DIR: '/Users/u/Library/Application Support/GTD-dev' }],
    ['一時ディレクトリそのもの', { ...base, GTD_DEV_USER_DATA_DIR: TMP }],
    ['..で外へ出る', { ...base, GTD_DEV_USER_DATA_DIR: `${TMP}/../../Library/GTD` }],
    ['hiddenで表示先を指定', { ...base, GTD_TEST_DISPLAY_ID: '1' }],
    ['表示先IDが数値でない', { ...base, GTD_TEST_UI: 'secondary', GTD_TEST_DISPLAY_ID: 'x' }],
    ['回答がJSONでない', { ...base, GTD_TEST_DIALOG_ANSWERS: '保存して終了' }],
    ['回答の形式が違う', { ...base, GTD_TEST_DIALOG_ANSWERS: JSON.stringify([{ response: 0 }]) }]
  ])('設定の誤り（%s）は開始しない', (_label, env) => {
    expect(resolve(env).kind).toBe('error')
  })

  it('ダイアログの回答を読み取る', () => {
    const answers = [{ button: '保存して終了', message: 'プロジェクト名に未保存の変更があります' }]
    const result = resolve({ ...base, GTD_TEST_DIALOG_ANSWERS: JSON.stringify(answers) })
    expect(result.kind === 'on' && result.config.dialogAnswers).toEqual(answers)
  })
})

describe('セカンダリ表示の表示先', () => {
  const area = (x: number, width = 1920, height = 1170) => ({ x, y: 0, width, height })
  const primary = { id: 10, workArea: area(0, 2560, 1358) }
  const left = { id: 20, workArea: area(-1920) }
  const right = { id: 30, workArea: area(2560) }

  it('プライマリはIDで判定する（配列の順番・座標では判定しない）', () => {
    // プライマリが配列の2番目・x>0 でも選ばない
    const shiftedPrimary = { id: 10, workArea: area(1920) }
    expect(selectTestDisplay([{ id: 20, workArea: area(0) }, shiftedPrimary], 10, null)).toEqual({
      ok: true,
      display: { id: 20, workArea: area(0) }
    })
    expect(selectTestDisplay([primary, left], 10, null)).toEqual({ ok: true, display: left })
  })

  it('プライマリ以外がない場合は表示しない', () => {
    const result = selectTestDisplay([primary], 10, null)
    expect(result.ok).toBe(false)
  })

  it('プライマリ以外が複数あれば、指定を求めて表示しない。指定すればそれを使う', () => {
    const result = selectTestDisplay([primary, left, right], 10, null)
    expect(result.ok === false && result.reason).toContain('GTD_TEST_DISPLAY_ID')
    expect(selectTestDisplay([primary, left, right], 10, 30)).toEqual({ ok: true, display: right })
  })

  it('指定したIDがない・プライマリなら表示しない', () => {
    expect(selectTestDisplay([primary, left], 10, 99).ok).toBe(false)
    expect(selectTestDisplay([primary, left], 10, 10).ok).toBe(false)
  })

  it('作業領域の中央に収まる位置とサイズにする', () => {
    expect(fitWindowBounds(area(2560), { width: 1200, height: 760 }, { width: 800, height: 480 })).toEqual({
      ok: true,
      bounds: { x: 2560 + 360, y: 205, width: 1200, height: 760 }
    })
    expect(fitWindowBounds({ x: -1000, y: 25, width: 1000, height: 700 }, { width: 1200, height: 760 }, { width: 800, height: 480 })).toEqual({
      ok: true,
      bounds: { x: -1000, y: 25, width: 1000, height: 700 }
    })
    expect(fitWindowBounds(area(0, 700, 400), { width: 1200, height: 760 }, { width: 800, height: 480 }).ok).toBe(false)
  })
})

describe('テスト用のダイアログ（指定した回答を使う）', () => {
  const request: MessageBoxRequest = {
    type: 'warning',
    message: 'プロジェクト名に未保存の変更があります',
    buttons: ['保存して終了', '保存せずに終了', 'キャンセル'],
    defaultId: 0,
    cancelId: 2
  }
  const logger = () => ({ info: vi.fn(), error: vi.fn() })

  it('指定した回答のボタンを順番に選ぶ', async () => {
    const box = createScriptedMessageBox(
      [{ button: '保存せずに終了' }, { button: '保存して終了', message: request.message }],
      logger()
    )
    expect(await box.show(request)).toBe(1)
    expect(await box.show(request)).toBe(0)
    expect(box.failures()).toEqual([])
  })

  it('回答が未指定なら、保存も破棄も選ばずにキャンセルを返し、失敗として記録する', async () => {
    const log = logger()
    const box = createScriptedMessageBox([], log)
    expect(await box.show(request)).toBe(request.cancelId)
    expect(box.failures()).toHaveLength(1)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('[test-dialog] FAIL'))
  })

  it('ボタン名・見出しが一致しなければキャンセルを返し、失敗として記録する', async () => {
    const box = createScriptedMessageBox(
      [{ button: '破棄' }, { button: '保存して終了', message: 'タスクのタイトルに未保存の変更があります' }],
      logger()
    )
    expect(await box.show(request)).toBe(2)
    expect(await box.show(request)).toBe(2)
    expect(box.failures()).toHaveLength(2)
  })

  it('エラー通知は画面に出さずに記録する', () => {
    const log = logger()
    createScriptedMessageBox([], log).showError('データベースを開けませんでした', '詳細')
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('[test-dialog] error-box'))
  })
})
