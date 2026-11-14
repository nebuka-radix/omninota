import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Box } from '@mui/material'
import { TASK_BULK_MAX, type TaskDto } from '../../../../shared/contracts/tasks'
import { useDraftGuard } from '../drafts/DraftGuard'
import { useSetTasksDayMutation } from '../tasks/task-queries'
import { EMPTY_SELECTION, pruneSelection, selectOnly, type TaskSelection } from '../tasks/selection'

type Day = 'today' | 'tomorrow'
export type DayDragRow = { task: TaskDto; section: string }

export function useDayTaskDrag(options: {
  enabled: boolean
  rows: readonly DayDragRow[]
  pendingIds: ReadonlySet<string>
  onMoved: (day: Day) => void
  onAnnounce: (message: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<TaskSelection>(EMPTY_SELECTION)
  const selectionRef = useRef(selection)
  const [over, setOver] = useState<Day | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number; count: number; moving: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const cleanupRef = useRef<(() => void) | null>(null)
  const savingRef = useRef(false)
  const blankPressCleanupRef = useRef<(() => void) | null>(null)
  const suppressBlankClickRef = useRef(false)
  const mutation = useSetTasksDayMutation()
  const { confirmLeave } = useDraftGuard()
  const changeSelection = (next: TaskSelection) => {
    selectionRef.current = next
    setSelection(next)
  }
  useEffect(() => {
    const visible = new Set(options.rows.map((row) => row.task.id))
    const next = pruneSelection(selectionRef.current, visible)
    if (next !== selectionRef.current) changeSelection(next)
  }, [options.rows])
  useEffect(() => () => {
    blankPressCleanupRef.current?.()
    cleanupRef.current?.()
  }, [])

  const start = (task: TaskDto, point: { x: number; y: number }) => {
    const opts = optionsRef.current
    if (!opts.enabled || savingRef.current || opts.pendingIds.has(task.id) || task.doneOn !== null) return
    cleanupRef.current?.()
    const initial = selectionRef.current
    const moving = initial.ids.has(task.id)
    const rows = opts.rows
    const origin = rows.find((row) => row.task.id === task.id)
    if (!origin) return
    const order = rows.filter((row) => row.section === origin.section).map((row) => row.task.id)
    const from = order.indexOf(task.id)
    const ids = moving ? rows.filter((row) => initial.ids.has(row.task.id)).map((row) => row.task.id) : [task.id]
    if (ids.length > TASK_BULK_MAX || ids.some((id) => opts.pendingIds.has(id))) {
      setError(`保存中のタスクが含まれるか、選択件数が上限（${TASK_BULK_MAX}件）を超えています。`)
      return
    }
    if (!moving) changeSelection(selectOnly(task.id))
    setError(null)
    let x = point.x
    let y = point.y
    let frame = 0
    let alive = true
    let target: Day | null = null
    const previousSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const hit = () => document.elementFromPoint(x, y)
    const update = () => {
      const element = hit()
      if (moving) {
        const candidate = element?.closest<HTMLElement>('[data-day-drop]')
        const day = candidate?.dataset.dayDrop
        target = candidate && containerRef.current?.contains(candidate) && (day === 'today' || day === 'tomorrow') ? day : null
        setOver(target)
      } else {
        const row = element?.closest<HTMLElement>('[data-task-id], [data-task-row-controls]')
        const id = row?.dataset.taskId ?? row?.dataset.taskRowControls
        const to = id ? order.indexOf(id) : -1
        if (to >= 0) {
          const start = Math.min(from, to)
          const end = Math.max(from, to)
          changeSelection({ ids: new Set(order.slice(start, end + 1)), anchorId: task.id })
        }
      }
      setGhost({ x, y, count: moving ? ids.length : selectionRef.current.ids.size, moving })
    }
    const tick = () => {
      if (!alive) return
      const container = containerRef.current
      if (container) {
        const rect = container.getBoundingClientRect()
        if (x >= rect.left && x <= rect.right && y >= rect.top - 24 && y <= rect.bottom + 24) {
          const delta = y < rect.top + 28 ? -10 : y > rect.bottom - 28 ? 10 : 0
          if (delta) { container.scrollTop += delta; update() }
        }
      }
      frame = requestAnimationFrame(tick)
    }
    const cleanup = () => {
      alive = false
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', cancel)
      document.body.style.userSelect = previousSelect
      cleanupRef.current = null
      setGhost(null)
      setOver(null)
    }
    const cancel = () => {
      cleanup()
      if (!moving) changeSelection(initial)
    }
    const onMove = (event: PointerEvent) => {
      x = event.clientX; y = event.clientY
      event.preventDefault()
      update()
    }
    const commit = async (day: Day) => {
      savingRef.current = true
      try {
        if (!(await confirmLeave())) return
        await mutation.mutateAsync({ ids, day })
        changeSelection(EMPTY_SELECTION)
        optionsRef.current.onMoved(day)
        optionsRef.current.onAnnounce(`${ids.length}件の期限を${day === 'today' ? '今日' : '明日'}に変更しました`)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '期限を変更できませんでした')
      } finally { savingRef.current = false }
    }
    const onUp = (event: PointerEvent) => {
      x = event.clientX; y = event.clientY
      update()
      const destination = target
      cleanup()
      if (moving && destination) void commit(destination)
      else if (!moving) optionsRef.current.onAnnounce(`${selectionRef.current.ids.size}件を選択しました`)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation()
      cancel()
    }
    cleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', cancel)
    update()
    frame = requestAnimationFrame(tick)
  }
  const onBlankPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!optionsRef.current.enabled || savingRef.current || event.button !== 0 || !event.isPrimary ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const element = event.target instanceof Element ? event.target : null
    if (!element || element.closest('button, input, textarea, select, a, [role="button"], .MuiCheckbox-root, [data-testid="task-title"], [data-testid="inline-title-editor-row"], [data-testid="inline-title-error"]')) return
    const row = element.closest<HTMLElement>('[data-task-id], [data-task-row-controls]')
    if (!row || !containerRef.current?.contains(row)) return
    const id = row.dataset.taskId ?? row.dataset.taskRowControls
    if (!id || !selectionRef.current.ids.has(id)) return
    const task = optionsRef.current.rows.find((item) => item.task.id === id)?.task
    if (!task || optionsRef.current.pendingIds.has(id)) return
    // 行の空白を覆う要素のstopPropagationより前に、移動開始を受け付ける。
    event.preventDefault()
    event.stopPropagation()
    blankPressCleanupRef.current?.()
    suppressBlankClickRef.current = false
    const x = event.clientX
    const y = event.clientY
    const pointerId = event.pointerId
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', cleanup)
      blankPressCleanupRef.current = null
    }
    const move = (native: PointerEvent) => {
      if (native.pointerId !== pointerId || Math.hypot(native.clientX - x, native.clientY - y) < 5) return
      cleanup()
      suppressBlankClickRef.current = true
      start(task, { x: native.clientX, y: native.clientY })
    }
    const release = (native: PointerEvent) => {
      if (native.pointerId === pointerId) cleanup()
    }
    const key = (native: KeyboardEvent) => { if (native.key === 'Escape') cleanup() }
    blankPressCleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', cleanup)
  }
  const onBlankClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressBlankClickRef.current) return
    suppressBlankClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }
  const elements = ghost ? createPortal(
    <Box sx={{ position: 'fixed', left: ghost.x + 12, top: ghost.y + 12, zIndex: 2000, pointerEvents: 'none',
      bgcolor: '#2b2b2b', color: '#eeeeee', px: 2, py: 1, fontSize: 12, borderRadius: 1 }}>
      {ghost.count}件 {ghost.moving ? '移動' : '選択'}
    </Box>, document.body
  ) : null
  return { containerRef, selection, changeSelection, start, onBlankPointerDown, onBlankClickCapture, over, error, clearError: () => setError(null), elements }
}
