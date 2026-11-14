import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress } from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { NotesPage } from '../../routes/NotesPage'
import { useDraftGuard } from '../drafts/DraftGuard'
import { unwrapIpc } from '../../lib/ipc'
import { vscodeColors } from '../../theme'
import { NotesSidebar } from './NotesSidebar'
import { noteWidthQueryOptions } from './note-queries'
import { clampCompactNoteWidth, compactNoteLayout, COMPACT_NOTE_DIVIDER } from './compact-note-layout'

export function CompactNotesPane() {
  const width = useQuery(noteWidthQueryOptions)
  if (width.data === undefined) {
    if (width.isError) return <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void width.refetch()}>再試行</Button>}>
      ノート一覧の幅を読み込めませんでした: {width.error.message}
    </Alert>
    return <Box role="status" aria-label="NOTEを読み込み中" sx={{ p: 2 }}><CircularProgress size={16} /></Box>
  }
  return <CompactNotesWorkspace initialWidth={width.data} />
}

function CompactNotesWorkspace({ initialWidth }: { initialWidth: number }) {
  const { register } = useDraftGuard()
  const client = useQueryClient()
  const [preferred, setPreferred] = useState(() => clampCompactNoteWidth(initialWidth))
  const [totalWidth, setTotalWidth] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const preferredRef = useRef(clampCompactNoteWidth(initialWidth))
  const savedRef = useRef(clampCompactNoteWidth(initialWidth))
  const queue = useRef<Promise<void>>(Promise.resolve())
  const mounted = useRef(true)
  const drag = useRef<{ id: number; x: number; width: number; previous: number; moved: boolean } | null>(null)
  const layout = compactNoteLayout(totalWidth, preferred)
  const setWidth = (width: number) => { const next = clampCompactNoteWidth(width); preferredRef.current = next; setPreferred(next) }
  const persist = (width: number): Promise<boolean> => {
    const next = clampCompactNoteWidth(width)
    preferredRef.current = next
    const job = queue.current.then(async () => {
      try {
        await client.cancelQueries({ queryKey: noteWidthQueryOptions.queryKey })
        await unwrapIpc(window.gtd.notes.saveSidebarWidth(next))
        savedRef.current = next
        client.setQueryData(noteWidthQueryOptions.queryKey, next)
        if (mounted.current) setError(null)
        return true
      } catch (caught) {
        if (mounted.current) setError(caught instanceof Error ? caught.message : String(caught))
        return false
      }
    })
    queue.current = job.then(() => {})
    return job
  }
  const persistRef = useRef(persist)
  persistRef.current = persist
  useLayoutEffect(() => {
    const element = bodyRef.current
    if (!element) return
    const measure = () => setTotalWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    mounted.current = true
    const unregister = register({
      kind: 'note', targetId: 'compact-note-sidebar-width',
      isDirty: () => preferredRef.current !== savedRef.current,
      save: () => persistRef.current(preferredRef.current),
      discard: () => { preferredRef.current = savedRef.current; setPreferred(savedRef.current); setError(null) },
      waitForSave: async () => { await queue.current }
    })
    return () => { mounted.current = false; unregister() }
  }, [register])
  const cancelDrag = () => {
    if (!drag.current) return
    setWidth(drag.current.previous)
    drag.current = null
  }
  return (
    <Box data-testid="compact-notes-pane" sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 }}>
      {error && <Alert severity="error" sx={{ flexShrink: 0 }}>一覧の幅を保存できませんでした: {error}</Alert>}
      <Box ref={bodyRef} sx={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
        <Box component="aside" aria-label="NOTE LIST" data-preferred-width={preferred}
          sx={{ width: layout.width, flexShrink: 0, height: '100%', minHeight: 0, minWidth: 0, overflow: 'hidden', bgcolor: vscodeColors.sideBarBackground }}>
          <NotesSidebar pathname="/notes" expanded embedded />
        </Box>
        <Box role="separator" tabIndex={0} aria-label="NOTE一覧の幅を調整" aria-orientation="vertical"
          aria-valuemin={Math.round(layout.minimum)} aria-valuemax={Math.round(layout.maximum)} aria-valuenow={Math.round(layout.width)}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { id: event.pointerId, x: event.clientX, width: layout.width, previous: preferredRef.current, moved: false }
          }}
          onPointerMove={(event) => {
            const operation = drag.current
            if (!operation || operation.id !== event.pointerId) return
            const delta = event.clientX - operation.x
            if (!operation.moved && Math.abs(delta) < 1) return
            operation.moved = true
            const current = compactNoteLayout(bodyRef.current?.clientWidth ?? totalWidth, preferredRef.current)
            setWidth(Math.max(current.minimum, Math.min(current.maximum, operation.width + delta)))
          }}
          onPointerUp={(event) => {
            const operation = drag.current
            if (!operation || operation.id !== event.pointerId) return
            drag.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
            if (operation.moved) void persist(preferredRef.current)
          }}
          onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
          onKeyDown={(event) => {
            let next = layout.width
            if (event.key === 'ArrowLeft') next -= 10
            else if (event.key === 'ArrowRight') next += 10
            else if (event.key === 'Home') next = layout.minimum
            else if (event.key === 'End') next = layout.maximum
            else return
            event.preventDefault(); event.stopPropagation()
            next = clampCompactNoteWidth(Math.max(layout.minimum, Math.min(layout.maximum, next)))
            if (next === preferredRef.current) return
            setWidth(next); void persist(next)
          }}
          sx={{ width: COMPACT_NOTE_DIVIDER, flexShrink: 0, cursor: 'col-resize', touchAction: 'none', bgcolor: vscodeColors.border,
            '&:hover, &:focus-visible': { bgcolor: vscodeColors.focusBorder } }} />
        <Box component="section" aria-label="NOTE EDITOR" sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          <NotesPage />
        </Box>
      </Box>
    </Box>
  )
}
