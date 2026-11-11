import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { Ban, Link2 } from 'lucide-react'
import { vscodeColors } from '../../theme'

// Inboxのタスク → 右サイドバー（紐付け先）のマイルストンへのドラッグ＆ドロップ（フェーズ5.9）。
// 依存を追加せず Pointer Events で実装する（HTML5 DnD は使わない）。
// - ドロップ先は data-drop-milestone-id（と data-drop-project-id・data-drop-label）を持つ要素。
//   data-drop-blocked（理由）を持つ要素の上では「ドロップできません」と理由を示す（マイルストンのないプロジェクトなど）。
// - ドラッグ中はポインターの近くに、対象件数とドロップ先（または不可の理由）を表示する。
// - Esc・ウィンドウからのフォーカス喪失・ポインターの取り消しでは保存しない。ドロップ先以外で離した場合も保存しない。
// - スクロール: data-drag-autoscroll を持つ領域の上下端に近づくと、その領域を自動でスクロールする（ホイールでのスクロールもできる）。
//   スクロール後もポインターの下のドロップ先を判定し直す。
// - 保存（検証・トランザクション）は呼び出し側（onDrop → 一括紐付けAPI）が行う。ここではドロップ先を通知するだけ。
export type DropTarget = { projectId: string; milestoneId: string; label: string }

type DragSession = {
  taskIds: readonly string[]
  // 件数の表示に使う（1件ならタスク名）
  label: string
  onDrop: (target: DropTarget) => void
}

type Over = { kind: 'target'; target: DropTarget } | { kind: 'blocked'; reason: string } | null

type DragState = { session: DragSession; x: number; y: number; over: Over }

type TaskDragValue = {
  // ドラッグを始める（呼び出し側がしきい値を超えた移動を検出してから呼ぶ）
  startDrag: (session: DragSession, point: { x: number; y: number }) => void
  // ドラッグ中ならその情報（ドロップ先の強調表示などに使う）
  dragging: { count: number; overMilestoneId: string | null } | null
}

const TaskDragContext = createContext<TaskDragValue | null>(null)

const AUTOSCROLL_EDGE = 36
const AUTOSCROLL_STEP = 14

function hitTest(x: number, y: number): Over {
  const element = document.elementFromPoint(x, y)
  if (!element) return null
  const blocked = element.closest<HTMLElement>('[data-drop-blocked]')
  if (blocked) return { kind: 'blocked', reason: blocked.dataset['dropBlocked'] ?? 'ここにはドロップできません' }
  const target = element.closest<HTMLElement>('[data-drop-milestone-id]')
  if (!target) return null
  const { dropMilestoneId, dropProjectId, dropLabel } = target.dataset
  if (!dropMilestoneId || !dropProjectId) return null
  return { kind: 'target', target: { milestoneId: dropMilestoneId, projectId: dropProjectId, label: dropLabel ?? '' } }
}

const overKey = (over: Over) =>
  over === null ? '' : over.kind === 'blocked' ? `blocked:${over.reason}` : `target:${over.target.milestoneId}:${over.target.label}`

export function TaskDragProvider({ children }: { children: ReactNode }) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const pointRef = useRef({ x: 0, y: 0 })
  const cleanupRef = useRef<(() => void) | null>(null)

  const update = useCallback((next: DragState | null) => {
    dragRef.current = next
    setDrag(next)
  }, [])

  const finish = useCallback(
    (drop: boolean) => {
      const current = dragRef.current
      cleanupRef.current?.()
      cleanupRef.current = null
      update(null)
      if (!drop || !current) return
      // 離した位置で判定し直す（直前のスクロール・一覧の更新を反映する）
      const over = hitTest(pointRef.current.x, pointRef.current.y)
      if (over?.kind === 'target') current.session.onDrop(over.target)
    },
    [update]
  )

  const startDrag = useCallback<TaskDragValue['startDrag']>(
    (session, point) => {
      if (dragRef.current) return
      pointRef.current = point
      update({ session, x: point.x, y: point.y, over: hitTest(point.x, point.y) })

      const refresh = () => {
        const current = dragRef.current
        if (!current) return
        const { x, y } = pointRef.current
        const over = hitTest(x, y)
        if (current.x === x && current.y === y && overKey(current.over) === overKey(over)) return
        update({ ...current, x, y, over })
      }
      const onMove = (event: PointerEvent) => {
        pointRef.current = { x: event.clientX, y: event.clientY }
        refresh()
      }
      const onUp = () => finish(true)
      const onCancel = () => finish(false)
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        // ドラッグの取り消しだけに使う（一覧・メニューなどの Esc の処理へ伝えない）
        event.preventDefault()
        event.stopPropagation()
        finish(false)
      }
      // 端に近い間は一定間隔で自動スクロールする
      let frame = 0
      const tick = () => {
        const { x, y } = pointRef.current
        const area = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drag-autoscroll]')
        if (area) {
          const rect = area.getBoundingClientRect()
          const delta = y < rect.top + AUTOSCROLL_EDGE ? -AUTOSCROLL_STEP : y > rect.bottom - AUTOSCROLL_EDGE ? AUTOSCROLL_STEP : 0
          if (delta !== 0) {
            area.scrollTop += delta
            refresh()
          }
        }
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
      const onScroll = () => refresh()

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('blur', onCancel)
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('scroll', onScroll, true)
      const previousCursor = document.body.style.cursor
      document.body.style.cursor = 'grabbing'
      cleanupRef.current = () => {
        cancelAnimationFrame(frame)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('blur', onCancel)
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('scroll', onScroll, true)
        document.body.style.cursor = previousCursor
      }
    },
    [finish, update]
  )

  // アンマウント時は取り消す（保存しない）
  useEffect(() => () => cleanupRef.current?.(), [])

  const value = useMemo<TaskDragValue>(
    () => ({
      startDrag,
      dragging: drag
        ? { count: drag.session.taskIds.length, overMilestoneId: drag.over?.kind === 'target' ? drag.over.target.milestoneId : null }
        : null
    }),
    [startDrag, drag]
  )

  const count = drag?.session.taskIds.length ?? 0
  const subject = drag ? (count === 1 ? `「${drag.session.label}」` : `${count} 件のタスク`) : ''
  const message = !drag
    ? ''
    : drag.over?.kind === 'target'
      ? `${subject}を「${drag.over.target.label}」に紐付け`
      : drag.over?.kind === 'blocked'
        ? `ドロップできません: ${drag.over.reason}`
        : `${subject}を移動中 — 右の「紐付け先」のマイルストンへドロップ（Esc で取り消し）`

  return (
    <TaskDragContext.Provider value={value}>
      {children}
      {drag && (
        <Box
          data-testid="task-drag-preview"
          data-drag-count={count}
          data-drag-state={drag.over?.kind ?? 'none'}
          aria-hidden
          sx={{
            position: 'fixed',
            left: drag.x + 14,
            top: drag.y + 10,
            zIndex: 2000,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            maxWidth: 360,
            px: 1.5,
            py: 0.75,
            borderRadius: 1,
            fontSize: 12,
            bgcolor: vscodeColors.sideBarBackground,
            border: `1px solid ${drag.over?.kind === 'target' ? vscodeColors.focusBorder : drag.over?.kind === 'blocked' ? '#f14c4c' : vscodeColors.border}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
          }}
        >
          {drag.over?.kind === 'blocked' ? <Ban size={14} aria-hidden /> : <Link2 size={14} aria-hidden />}
          <Typography component="span" sx={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {message}
          </Typography>
        </Box>
      )}
      {/* 読み上げ: ドラッグ中の対象とドロップ先 */}
      <Box
        role="status"
        aria-live="polite"
        data-testid="task-drag-status"
        sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        {message}
      </Box>
    </TaskDragContext.Provider>
  )
}

export function useTaskDrag(): TaskDragValue {
  const value = useContext(TaskDragContext)
  if (!value) throw new Error('useTaskDrag は TaskDragProvider の内側で使ってください')
  return value
}
