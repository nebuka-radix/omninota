// 自動テスト用の起動モード（GTD_TEST_UI）。Electronに依存しない純粋な関数だけを置く（ホストNode.jsのテストで検証する）。
// - hidden: ウィンドウを表示しない（Electronの非表示ウィンドウ。完全なヘッドレスではない）
// - secondary: プライマリ以外のディスプレイに、フォーカスを奪わずに表示する
// 未パッケージ時だけ有効。パッケージ版では環境変数を無視し、通常どおり起動する。
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

export const TEST_UI_MODES = ['hidden', 'secondary'] as const
export type TestUiMode = (typeof TEST_UI_MODES)[number]

// ネイティブダイアログへの回答（1回の表示につき1件、順番に使う）。button はボタンの表示名。
// message を指定すると、表示されたダイアログの見出しと一致するかも確かめる。
export type DialogAnswer = { button: string; message?: string | undefined }

export type TestModeConfig = {
  mode: TestUiMode
  // 表示先ディスプレイのID（secondaryのみ。未指定なら非プライマリが1台だけの場合に自動で選ぶ）
  displayId: number | null
  dialogAnswers: DialogAnswer[]
}

export type TestModeResolution =
  | { kind: 'off'; ignoredInPackagedApp: boolean }
  | { kind: 'on'; config: TestModeConfig }
  | { kind: 'error'; reason: string }

const dialogAnswersSchema = z.array(
  z.strictObject({ button: z.string().min(1), message: z.string().min(1).optional() })
)

// path が root の内側（root自身は除く）かどうか。'..' などは resolve で正規化してから判定する。
function isInside(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`)
}

export function resolveTestMode(options: {
  env: Record<string, string | undefined>
  isPackaged: boolean
  // 一時ディレクトリとして認める場所（os.tmpdir() など）
  tempRoots: string[]
}): TestModeResolution {
  const { env } = options
  const raw = env['GTD_TEST_UI']
  if (raw === undefined || raw === '') return { kind: 'off', ignoredInPackagedApp: false }
  if (options.isPackaged) return { kind: 'off', ignoredInPackagedApp: true }

  if (!(TEST_UI_MODES as readonly string[]).includes(raw)) {
    return { kind: 'error', reason: `GTD_TEST_UI の値が不正です: ${raw}（hidden / secondary）` }
  }
  const mode = raw as TestUiMode

  // 専用の一時userDataを必須にする（開発DB・通常利用DBを使わせない）
  const userDataDir = env['GTD_DEV_USER_DATA_DIR']
  if (!userDataDir || !isAbsolute(userDataDir)) {
    return { kind: 'error', reason: 'テストモードでは GTD_DEV_USER_DATA_DIR に一時ディレクトリの絶対パスが必要です' }
  }
  if (!options.tempRoots.some((root) => isInside(userDataDir, root))) {
    return {
      kind: 'error',
      reason: `GTD_DEV_USER_DATA_DIR は一時ディレクトリ（${options.tempRoots.join(' / ')}）の中を指定してください: ${userDataDir}`
    }
  }

  let displayId: number | null = null
  const rawDisplay = env['GTD_TEST_DISPLAY_ID']
  if (rawDisplay !== undefined && rawDisplay !== '') {
    if (mode !== 'secondary') return { kind: 'error', reason: 'GTD_TEST_DISPLAY_ID は secondary でだけ指定できます' }
    if (!/^\d+$/.test(rawDisplay)) return { kind: 'error', reason: `GTD_TEST_DISPLAY_ID が不正です: ${rawDisplay}` }
    displayId = Number(rawDisplay)
  }

  let dialogAnswers: DialogAnswer[] = []
  const rawAnswers = env['GTD_TEST_DIALOG_ANSWERS']
  if (rawAnswers !== undefined && rawAnswers !== '') {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawAnswers)
    } catch {
      return { kind: 'error', reason: 'GTD_TEST_DIALOG_ANSWERS がJSONとして読めません' }
    }
    const result = dialogAnswersSchema.safeParse(parsed)
    if (!result.success) return { kind: 'error', reason: 'GTD_TEST_DIALOG_ANSWERS の形式が不正です（[{ button, message? }]）' }
    dialogAnswers = result.data
  }

  return { kind: 'on', config: { mode, displayId, dialogAnswers } }
}

export type Rect = { x: number; y: number; width: number; height: number }
export type DisplayLike = { id: number; workArea: Rect }

// secondary の表示先を選ぶ。プライマリかどうかは getPrimaryDisplay() のIDとの比較で判定する（配列の順番や座標では判定しない）。
// 候補が見つからない・複数ある場合は、プライマリへ黙って表示せずに理由を返す。
export function selectTestDisplay(
  displays: DisplayLike[],
  primaryId: number,
  requestedId: number | null
): { ok: true; display: DisplayLike } | { ok: false; reason: string } {
  const describe = (list: DisplayLike[]) =>
    list.map((d) => `${d.id}${d.id === primaryId ? '（プライマリ）' : ''} ${d.workArea.width}x${d.workArea.height}`).join(', ')
  if (requestedId !== null) {
    const found = displays.find((display) => display.id === requestedId)
    if (!found) return { ok: false, reason: `指定したディスプレイ ${requestedId} がありません。接続中: ${describe(displays)}` }
    if (found.id === primaryId) return { ok: false, reason: `ディスプレイ ${requestedId} はプライマリのため表示しません` }
    return { ok: true, display: found }
  }
  const candidates = displays.filter((display) => display.id !== primaryId)
  if (candidates.length === 0) return { ok: false, reason: `プライマリ以外のディスプレイがありません。接続中: ${describe(displays)}` }
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: `プライマリ以外のディスプレイが複数あります。GTD_TEST_DISPLAY_ID で指定してください。接続中: ${describe(displays)}`
    }
  }
  return { ok: true, display: candidates[0] as DisplayLike }
}

// workArea の中央に、収まる大きさでウィンドウを置く。最小サイズが収まらない場合は理由を返す。
export function fitWindowBounds(
  workArea: Rect,
  preferred: { width: number; height: number },
  min: { width: number; height: number }
): { ok: true; bounds: Rect } | { ok: false; reason: string } {
  if (workArea.width < min.width || workArea.height < min.height) {
    return {
      ok: false,
      reason: `表示先の作業領域（${workArea.width}x${workArea.height}）がウィンドウの最小サイズ（${min.width}x${min.height}）より小さいため表示しません`
    }
  }
  const width = Math.min(preferred.width, workArea.width)
  const height = Math.min(preferred.height, workArea.height)
  return {
    ok: true,
    bounds: {
      x: workArea.x + Math.floor((workArea.width - width) / 2),
      y: workArea.y + Math.floor((workArea.height - height) / 2),
      width,
      height
    }
  }
}
