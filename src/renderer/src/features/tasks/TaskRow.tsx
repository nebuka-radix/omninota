import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { Box, ButtonBase, Checkbox, Typography } from '@mui/material'
import { AlertTriangle, CalendarPlus, Link2, MoreHorizontal, Star } from 'lucide-react'
import { isTaskCompleted, type TaskDto } from '../../../../shared/contracts/tasks'
import { vscodeColors } from '../../theme'
import { dueLabelOf } from './due-format'
import { InlineTitleInput, type InlineTitleEditController } from './inline-title-edit'

// タスクの行（Inbox の一覧・プロジェクトのマイルストンカード・Summary Review のセクションで共通）。
// 2行構成:
// - 1行目（左寄せ）: 完了チェックボックス・タスク名
// - 2行目（左寄せ）: お気に入りの星・期限（未設定なら期限設定アイコン）・紐付けアイコン・「…」メニュー・所属（{プロジェクト名} / {マイルストン名}）
//   星のアイコンの左端は、1行目のタスク名の文字の左端と同じ位置（TEXT_INSET。ハンドルの有無によらず、タスク名の列の左端から同じ距離）。
//   所属は残りの幅を使い、1行で右端を「…」で省略する（全文はツールチップ）。所属がなければ（Inbox）何も出さない。
// 作成日時は表示しない（データ・並べ替えの条件は変えない）。
//
// アクセシビリティの構造:
// - 行の本体は一覧（role="listbox"）の option。option の中に操作要素を置かない（チェックボックスはマウス用の見た目で、読み上げ・Tab 移動の対象外。
//   キーボードは一覧の Space）。
// - 星・期限・紐付け・「…」・並べ替えのハンドル・インライン編集の入力欄は、同じ部品から一覧の外側の重ね合わせ層（controlsLayer）へ
//   ポータルで描画する（読み上げでは option と別のボタン。Tab 移動の対象は増やさない。キーボードは一覧のショートカット）。
// - 重ね合わせ層の操作（クリック・押下・フォーカス）は行の選択・ドラッグ・一覧のフォーカス処理へ伝えない。
//
// 画面ごとの違い（取得条件・選択集合・セクション・カード構成）は持たない。操作は TaskRowActions（呼び出し側の共通フック）を呼ぶだけ。
export const TASK_ROW_HEIGHT = 52
// 1行目（チェックボックス・タスク名）と2行目（操作）の位置
const LINE1_HEIGHT = 28
const LINE2_TOP = 26
const LINE2_HEIGHT = 24
// 並べ替えのハンドルの列（プロジェクトのカードだけ）とチェックボックスの列
export const HANDLE_COLUMN_WIDTH = 18
const CHECK_COLUMN_WIDTH = 32
// タスク名の列の左端から、タスク名の文字・2行目の星のアイコンの左端までの距離（1行目と2行目で共通）
const TEXT_INSET = 4
// 2行目の操作ボタンの大きさ。最小のカード幅（144px・並べ替えのハンドルあり）でも4つの操作が収まる大きさにする
const ICON_BUTTON = 20
const LINE2_RIGHT = 2
const STAR_ON = '#e2c541'
// 白抜きの星（未設定）。背景（#1e1e1e・#252526）に対して操作できると分かるコントラスト（3:1以上）を保つ淡い灰色
const STAR_OFF = '#9a9a9a'
const OVERDUE = '#f48771'

export const taskOptionId = (taskId: string) => `task-option-${taskId}`

// 行の操作（3画面で共通。useTaskRowActions が作る）
export type TaskRowActions = {
  // お気に入りの表示（保存待ち・保存中なら押した後の状態）
  isFavorite: (task: TaskDto) => boolean
  toggleCompleted: (task: TaskDto) => void
  toggleFavorite: (task: TaskDto) => void
  openDue: (task: TaskDto, anchor: HTMLElement) => void
  openAssign: (task: TaskDto, anchor: HTMLElement) => void
  openMenu: (task: TaskDto, anchor: HTMLElement) => void
  openEditor: (task: TaskDto, anchor: HTMLElement) => void
  // 現在の所属（「{プロジェクト名} / {マイルストン名}」）。所属がない（Inbox）・名前を取得できない時は null
  assignmentLabel: (task: TaskDto) => string | null
  inlineEdit: InlineTitleEditController
}

// 重ね合わせ層の操作を、行（option）・一覧へ伝えない
const stop = (event: SyntheticEvent) => event.stopPropagation()

export function TaskRow({
  task,
  top,
  listId,
  controlsLayer,
  today,
  actions,
  selected,
  active,
  pending,
  dimmed,
  handle,
  onRowPointerDown,
  onRowClick,
  onRowContextMenu,
  onTitleClick,
  onTitleDoubleClick,
  onInlineDone
}: {
  task: TaskDto
  // 行の上端（仮想リスト内の位置）
  top: number
  // 一覧（listbox）の DOM の id（操作の後に一覧へフォーカスを戻すため）
  listId: string
  controlsLayer: HTMLElement | null
  // ローカルの今日（"YYYY-MM-DD"。期限の表示）
  today: string
  actions: TaskRowActions
  selected: boolean
  // キーボードの現在行（枠線で示す）
  active: boolean
  // 保存中（薄く表示する）
  pending: boolean
  // 並べ替えのドラッグ中（薄く表示する）
  dimmed: boolean
  // 並べ替えのハンドル（プロジェクトのカード。省略時はハンドルの列なし）
  handle?: ReactNode
  onRowPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
  onRowClick: (event: ReactMouseEvent<HTMLElement>) => void
  onRowContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void
  // タスク名のクリック（シングル: 編集モーダル、ダブル: インライン編集。判定は一覧が行う）
  onTitleClick: (event: ReactMouseEvent<HTMLElement>) => void
  onTitleDoubleClick: (event: ReactMouseEvent<HTMLElement>) => void
  // インライン編集を Enter・Esc で閉じた時（一覧へフォーカスを戻す）
  onInlineDone: () => void
}) {
  const completed = isTaskCompleted(task)
  const favorite = actions.isFavorite(task)
  const due = dueLabelOf(task.dueto, today)
  const withHandle = handle !== undefined
  const leftEdge = (withHandle ? HANDLE_COLUMN_WIDTH : 0) + CHECK_COLUMN_WIDTH
  const editing = actions.inlineEdit.state?.taskId === task.id
  const editError = editing ? actions.inlineEdit.state?.error ?? null : null
  const assignment = actions.assignmentLabel(task)
  const assignmentText = assignment ?? 'Inbox'
  const opacity = pending || dimmed ? 0.5 : 1
  const titleQuoted = `「${task.title}」`

  const iconButton = {
    width: ICON_BUTTON,
    height: ICON_BUTTON,
    flexShrink: 0,
    borderRadius: 1,
    color: 'text.secondary',
    pointerEvents: 'auto',
    '&:hover': { bgcolor: vscodeColors.listHover, color: 'text.primary' },
    '&.Mui-disabled': { opacity: 0.4 }
  } as const

  const controls = (
    <Box
      data-list-id={listId}
      data-task-row-controls={task.id}
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onMouseDown={(event) => {
        event.stopPropagation()
        // ボタンを押してもフォーカスを一覧から移さない（キーボード操作を続けられる。閉じた後の戻り先も一覧になる）。入力欄は除く
        if (!(event.target instanceof HTMLElement && event.target.closest('input, textarea'))) event.preventDefault()
      }}
      onContextMenu={stop}
      onFocus={stop}
      onBlur={stop}
      onKeyDown={stop}
      sx={{ position: 'absolute', left: 0, width: '100%', top, height: TASK_ROW_HEIGHT, pointerEvents: 'none', opacity }}
    >
      {withHandle && (
        <Box sx={{ position: 'absolute', left: 0, top: 0, width: HANDLE_COLUMN_WIDTH, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto' }}>
          {handle}
        </Box>
      )}
      {/* 2行目（左寄せ）: 星・期限・紐付け・…・所属。左端はタスク名の列の左端 */}
      <Box
        sx={{
          position: 'absolute',
          top: LINE2_TOP,
          height: LINE2_HEIGHT,
          left: leftEdge,
          right: LINE2_RIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: '2px',
          minWidth: 0
        }}
      >
        <ButtonBase
          tabIndex={-1}
          aria-pressed={favorite}
          aria-label={`${titleQuoted}をお気に入り`}
          title={favorite ? 'お気に入り（押すと解除）' : 'お気に入りに追加'}
          data-testid="task-favorite"
          data-favorite={favorite ? 'true' : 'false'}
          onClick={() => actions.toggleFavorite(task)}
          // アイコンの左端をタスク名の文字の左端に揃える（ボタンの左の余白 = TEXT_INSET）
          sx={{ ...iconButton, justifyContent: 'flex-start', pl: `${TEXT_INSET}px`, color: favorite ? STAR_ON : STAR_OFF, '&:hover': { bgcolor: vscodeColors.listHover, color: favorite ? STAR_ON : 'text.primary' } }}
        >
          <Star size={14} aria-hidden fill={favorite ? STAR_ON : 'none'} strokeWidth={favorite ? 1.5 : 1.75} />
        </ButtonBase>
        {due ? (
          <ButtonBase
            tabIndex={-1}
            aria-haspopup="menu"
            aria-label={`${titleQuoted}の${due.description}。期限を変更`}
            title={`${due.description}（押すと変更）`}
            data-testid="task-due"
            data-due={task.dueto ?? undefined}
            data-due-kind={due.kind}
            disabled={pending}
            onClick={(event) => actions.openDue(task, event.currentTarget)}
            sx={{
              ...iconButton,
              width: 'auto',
              flexShrink: 1,
              minWidth: 0,
              height: 20,
              px: 0.75,
              gap: 0.5,
              fontSize: 11,
              lineHeight: '16px',
              fontVariantNumeric: 'tabular-nums',
              border: `1px solid ${due.kind === 'overdue' ? OVERDUE : vscodeColors.border}`,
              color: due.kind === 'overdue' ? OVERDUE : due.kind === 'today' ? 'text.primary' : 'text.secondary'
            }}
          >
            {due.kind === 'overdue' && <AlertTriangle size={11} aria-hidden style={{ flexShrink: 0 }} />}
            <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {due.text}
            </Box>
          </ButtonBase>
        ) : (
          <ButtonBase
            tabIndex={-1}
            aria-haspopup="menu"
            aria-label={`${titleQuoted}の期限を設定`}
            title="期限を設定"
            data-testid="task-due-set"
            disabled={pending}
            onClick={(event) => actions.openDue(task, event.currentTarget)}
            sx={iconButton}
          >
            <CalendarPlus size={14} aria-hidden />
          </ButtonBase>
        )}
        <ButtonBase
          tabIndex={-1}
          aria-haspopup="menu"
          aria-label={`${titleQuoted}の紐付け（現在: ${assignmentText}）`}
          title={`紐付け（現在: ${assignmentText}）`}
          data-testid="task-assign"
          data-assign-task-id={task.id}
          disabled={pending}
          onClick={(event) => actions.openAssign(task, event.currentTarget)}
          sx={iconButton}
        >
          <Link2 size={14} aria-hidden />
        </ButtonBase>
        <ButtonBase
          tabIndex={-1}
          aria-haspopup="menu"
          aria-label={`${titleQuoted}のメニュー`}
          title="メニュー"
          data-testid="task-row-menu-button"
          data-row-menu-task-id={task.id}
          onClick={(event) => actions.openMenu(task, event.currentTarget)}
          sx={iconButton}
        >
          <MoreHorizontal size={14} aria-hidden />
        </ButtonBase>
        {assignment && (
          // 所属（読み上げは行の名前に含めるため、ここは読み上げない）。操作の領域を先に確保し、残りの幅で省略表示する
          <Box
            component="span"
            aria-hidden
            title={assignment}
            data-testid="task-assignment"
            sx={{
              flex: '0 1000 auto',
              minWidth: 0,
              ml: 0.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 11,
              color: 'text.secondary',
              pointerEvents: 'auto'
            }}
          >
            {assignment}
          </Box>
        )}
      </Box>
      {/* インライン編集（タスク名の位置に重ねる。状態は画面単位で持ち、一覧は編集中の行を常に描画する） */}
      {editing && (
        <Box
          data-testid="inline-title-editor-row"
          sx={{ position: 'absolute', top: 1, left: leftEdge, right: 4, height: LINE1_HEIGHT - 2, display: 'flex', alignItems: 'center', pointerEvents: 'auto', zIndex: 1 }}
        >
          <InlineTitleInput controller={actions.inlineEdit} taskTitle={task.title} onDone={onInlineDone} />
        </Box>
      )}
      {editError && (
        <Typography
          id="inline-title-error"
          role="alert"
          data-testid="inline-title-error"
          sx={{
            position: 'absolute',
            top: LINE1_HEIGHT - 2,
            left: leftEdge + 4,
            zIndex: 2,
            px: 1,
            py: 0.25,
            fontSize: 11,
            color: OVERDUE,
            bgcolor: vscodeColors.sideBarBackground,
            border: `1px solid ${OVERDUE}`,
            borderRadius: 0.5,
            pointerEvents: 'auto'
          }}
        >
          {editError}
        </Typography>
      )}
    </Box>
  )

  return (
    <>
      <Box
        id={taskOptionId(task.id)}
        role="option"
        aria-selected={selected}
        aria-busy={pending || undefined}
        // 読み上げ名: タスク名・完了状態・お気に入り・期限（チェックボックス・操作ボタンは option の外）
        aria-label={`${task.title}、${completed ? '完了' : '未完了'}${favorite ? '、お気に入り' : ''}${due ? `、${due.description}` : ''}${assignment ? `、${assignment}` : ''}${pending ? '、保存中' : ''}`}
        data-task-id={task.id}
        data-task-row=""
        data-pending={pending || undefined}
        onPointerDown={onRowPointerDown}
        onClick={onRowClick}
        onContextMenu={onRowContextMenu}
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: TASK_ROW_HEIGHT,
          transform: `translateY(${top}px)`,
          display: 'grid',
          gridTemplateColumns: `${withHandle ? `${HANDLE_COLUMN_WIDTH}px ` : ''}${CHECK_COLUMN_WIDTH}px minmax(0, 1fr)`,
          gridTemplateRows: `${LINE1_HEIGHT}px 1fr`,
          cursor: 'default',
          // 保存中・ドラッグ中の行は薄く表示する
          opacity,
          bgcolor: selected ? vscodeColors.listActiveSelection : 'transparent',
          borderBottom: `1px solid ${vscodeColors.border}40`,
          // キーボードの現在行（フォーカス）は枠線、選択は背景色で区別する
          outline: active ? `1px solid ${vscodeColors.focusBorder}` : 'none',
          outlineOffset: -1,
          '&:hover': { bgcolor: selected ? vscodeColors.listActiveSelection : vscodeColors.listHover }
        }}
      >
        {withHandle && <span aria-hidden />}
        <Box
          sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
          // チェック操作で行の選択・編集モーダル・ドラッグを起こさない
          onClick={stop}
          onPointerDown={stop}
          onDoubleClick={stop}
          aria-hidden
        >
          <Checkbox
            size="small"
            checked={completed}
            disabled={pending}
            onChange={() => actions.toggleCompleted(task)}
            tabIndex={-1}
            slotProps={{ input: { 'aria-hidden': true, tabIndex: -1, 'data-testid': 'task-complete-checkbox' } as Record<string, unknown> }}
            sx={{ p: 0.5 }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, pr: 1 }}>
          <Typography
            component="span"
            noWrap
            data-testid="task-title"
            onClick={onTitleClick}
            onDoubleClick={onTitleDoubleClick}
            title={task.title}
            sx={{
              display: 'inline-block',
              maxWidth: '100%',
              fontSize: 13,
              pl: `${TEXT_INSET}px`,
              pr: 0.5,
              borderRadius: 0.5,
              cursor: 'pointer',
              // 完了は色だけでなく取り消し線でも示す
              textDecoration: completed ? 'line-through' : 'none',
              color: completed ? 'text.secondary' : 'text.primary',
              '&:hover': { textDecoration: completed ? 'line-through underline' : 'underline' }
            }}
          >
            {task.title}
          </Typography>
        </Box>
      </Box>
      {controlsLayer && createPortal(controls, controlsLayer)}
    </>
  )
}
