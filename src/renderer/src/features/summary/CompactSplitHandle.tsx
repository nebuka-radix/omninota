import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { Box } from '@mui/material'
import { vscodeColors } from '../../theme'

type Drag = { pointerId: number; initial: number; element: HTMLDivElement }

// Todayの占有率を変更する。寸法は操作ごとに測定し、ウィンドウの高さ変更にも追従する。
export function CompactSplitHandle({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const dragRef = useRef<Drag | null>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  const clamp = (next: number, element: HTMLElement) => {
    const height = element.parentElement?.getBoundingClientRect().height ?? 0
    const minimum = height > 0 ? Math.min(45, Math.max(10, 64 / height * 100)) : 10
    return Math.min(100 - minimum, Math.max(minimum, next))
  }
  const finish = (cancel: boolean) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (cancel) changeRef.current(drag.initial)
    if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)
  }
  useEffect(() => () => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)
  }, [])

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect || rect.height <= 0) return
    onChange(clamp((event.clientY - rect.top) / rect.height * 100, event.currentTarget))
  }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && dragRef.current) {
      event.preventDefault()
      event.stopPropagation()
      finish(true)
      return
    }
    if (dragRef.current) return
    const step = event.shiftKey ? 10 : 2
    const next = event.key === 'ArrowUp' ? value - step : event.key === 'ArrowDown' ? value + step : event.key === 'Home' ? 0 : event.key === 'End' ? 100 : null
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    onChange(clamp(next, event.currentTarget))
  }

  return (
    <Box
      role="separator"
      aria-label="TodayとTomorrowの高さを変更"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`Today ${Math.round(value)}%、Tomorrow ${Math.round(100 - value)}%`}
      tabIndex={0}
      data-testid="compact-height-resizer"
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || dragRef.current) return
        event.preventDefault()
        event.stopPropagation()
        const element = event.currentTarget
        element.focus()
        element.setPointerCapture(event.pointerId)
        dragRef.current = { pointerId: event.pointerId, initial: value, element }
      }}
      onPointerMove={move}
      onPointerUp={(event: PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return
        move(event)
        finish(false)
      }}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish(true)}
      onKeyDown={keyDown}
      onDoubleClick={() => onChange(50)}
      sx={{
        position: 'absolute', left: 0, right: 0, top: `calc(${value}% - 4px)`, height: 8,
        zIndex: 2, cursor: 'row-resize', touchAction: 'none', userSelect: 'none',
        '&::after': { content: '""', position: 'absolute', left: 0, right: 0, top: 3, height: 2, bgcolor: vscodeColors.gridLine },
        '&:hover::after, &:focus-visible::after': { bgcolor: vscodeColors.focusBorder },
        '&:focus-visible': { outline: `1px solid ${vscodeColors.focusBorder}`, outlineOffset: -1 }
      }}
    />
  )
}
