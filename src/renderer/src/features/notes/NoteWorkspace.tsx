import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, Box, Button, IconButton, List, ListItemButton, Typography } from '@mui/material'
import { Star } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { NOTE_SIDEBAR, type NoteDto } from '../../../../shared/contracts/notes'
import { unwrapIpc } from '../../lib/ipc'
import { useDraftGuard } from '../drafts/DraftGuard'
import { vscodeColors } from '../../theme'
import { NoteEditor } from './NoteEditor'
import { InlineNoteName } from './InlineNoteName'
import { noteWidthQueryOptions, useNoteMutations } from './note-queries'

export function NoteWorkspace({ notes, initialWidth }: { notes: readonly NoteDto[]; initialWidth: number }) {
  const { register, confirmLeave } = useDraftGuard()
  const client = useQueryClient()
  const mutations = useNoteMutations()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  useLayoutEffect(() => {
    if (selectedId === null) return
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>(`[data-note-id="${selectedId}"]`)
    if (!list || !row) return
    const outer = list.getBoundingClientRect()
    const inner = row.getBoundingClientRect()
    const top = inner.top - outer.top
    const bottom = inner.bottom - outer.top
    if (top < 0) list.scrollTop += top
    else if (bottom > list.clientHeight) list.scrollTop += bottom - list.clientHeight
  }, [selectedId, renamingId, notes.length])
  const [width, setWidth] = useState(initialWidth)
  const [available, setAvailable] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [widthError, setWidthError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(initialWidth)
  const savedWidth = useRef(initialWidth)
  const widthQueue = useRef<Promise<void>>(Promise.resolve())
  const actionBusy = useRef(false)
  const [actionPending, setActionPending] = useState(false)
  const active = useRef(true)
  const drag = useRef<{ id: number; x: number; width: number; previous: number } | null>(null)
  const maxVisible = available > 0 ? Math.max(100, available - 126) : NOTE_SIDEBAR.max
  const visibleWidth = Math.min(width, maxVisible)
  const clamp = (value: number) => Math.round(Math.max(NOTE_SIDEBAR.min, Math.min(NOTE_SIDEBAR.max, value)))

  const persistWidth = (value: number): Promise<boolean> => {
    widthRef.current = value
    const job = widthQueue.current.then(async () => {
      try {
        await unwrapIpc(window.gtd.notes.saveSidebarWidth(value))
        savedWidth.current = value
        client.setQueryData(noteWidthQueryOptions.queryKey, value)
        if (active.current) setWidthError(null)
        return true
      } catch (caught) {
        if (active.current) setWidthError(caught instanceof Error ? caught.message : String(caught))
        return false
      }
    })
    widthQueue.current = job.then(() => {})
    return job
  }
  const latestWidthSave = useRef(persistWidth)
  latestWidthSave.current = persistWidth
  useEffect(() => {
    active.current = true
    const element = rootRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setAvailable(element.getBoundingClientRect().width))
    observer.observe(element)
    return () => { active.current = false; observer.disconnect() }
  }, [])
  useEffect(() => register({
    kind: 'note', targetId: 'note-sidebar-width',
    isDirty: () => widthRef.current !== savedWidth.current,
    save: () => latestWidthSave.current(widthRef.current),
    discard: () => { widthRef.current = savedWidth.current; setWidth(savedWidth.current); setWidthError(null) },
    waitForSave: async () => { await widthQueue.current }
  }), [register])
  const selectNote = async (id: number) => {
    if (id === selectedId || actionBusy.current) return
    actionBusy.current = true
    try { if (await confirmLeave()) { setRenamingId(null); setSelectedId(id) } } finally { actionBusy.current = false }
  }
  const createNote = async () => {
    if (actionBusy.current) return
    actionBusy.current = true
    setActionPending(true)
    try {
      if (!await confirmLeave()) return
      setError(null)
      const note = await mutations.create.mutateAsync()
      setSelectedId(note.id)
      setRenamingId(note.id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { actionBusy.current = false; setActionPending(false) }
  }
  const favorite = async (note: NoteDto) => {
    if (actionBusy.current) return
    actionBusy.current = true
    setActionPending(true)
    try {
      setError(null)
      await mutations.favorite.mutateAsync({ id: note.id, favorite: !note.favorite })
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { actionBusy.current = false; setActionPending(false) }
  }
  const selected = notes.find((note) => note.id === selectedId)
  return (
    <Box ref={rootRef} sx={{ display: 'flex', height: '100%', minHeight: 0, minWidth: 0, overflow: 'hidden' }} data-testid="note-workspace">
      <Box component="aside" aria-label="ノート一覧" sx={{ width: visibleWidth, flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: vscodeColors.sideBarBackground, height: '100%', overflow: 'hidden' }}>
        <Box sx={{ flexShrink: 0, position: 'sticky', top: 0, zIndex: 1, bgcolor: vscodeColors.sideBarBackground }}>
        <Button onClick={() => void createNote()} disabled={actionPending} sx={{ height: 34, width: '100%', justifyContent: 'flex-start', px: 2, flexShrink: 0, textTransform: 'none' }} data-testid="new-note">
          + New Note
        </Button>
        </Box>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {widthError && <Alert severity="error">幅を保存できませんでした: {widthError}</Alert>}
        <List ref={listRef} sx={{ m: 0, p: 0, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }} aria-label="ノート"
          onKeyDown={(event) => {
            if (event.key !== 'F2' || event.nativeEvent.isComposing || event.target instanceof HTMLInputElement) return
            if (selectedId === null || actionBusy.current) return
            event.preventDefault(); event.stopPropagation(); setRenamingId(selectedId)
          }}>
          {notes.map((note) => (
            <Box component="li" key={note.id} data-note-id={note.id} sx={{ display: 'flex', alignItems: 'center', bgcolor: note.id === selectedId ? vscodeColors.listActiveSelection : 'transparent' }}>
              <IconButton aria-label={`${note.name}のお気に入りを${note.favorite ? '解除' : '設定'}`} aria-pressed={note.favorite}
                disabled={actionPending} onClick={() => void favorite(note)}
                sx={{ width: 28, height: 30, flexShrink: 0, color: note.favorite ? '#e2c541' : 'text.secondary' }}>
                <Star size={15} fill={note.favorite ? '#e2c541' : 'none'} aria-hidden />
              </IconButton>
              {renamingId === note.id ? (
                <InlineNoteName key={note.id} note={note} onDone={(restoreFocus) => {
                  setRenamingId(null)
                  if (restoreFocus) requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-note-id="${note.id}"] [data-note-select]`)?.focus({ preventScroll: true }))
                }} />
              ) : (
                <ListItemButton component="button" data-note-select selected={note.id === selectedId} onClick={() => void selectNote(note.id)}
                  aria-current={note.id === selectedId ? 'true' : undefined}
                  sx={{ flex: 1, minWidth: 0, height: 30, p: 0, pr: 2, textAlign: 'left' }}>
                  <Typography component="span" noWrap title={note.name} sx={{ fontSize: 13, minWidth: 0 }}>{note.name}</Typography>
                </ListItemButton>
              )}
            </Box>
          ))}
        </List>
      </Box>
      <Box role="separator" tabIndex={0} aria-label="ノート一覧の幅を調整" aria-orientation="vertical"
        aria-valuemin={NOTE_SIDEBAR.min} aria-valuemax={NOTE_SIDEBAR.max} aria-valuenow={width}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { id: event.pointerId, x: event.clientX, width: visibleWidth, previous: widthRef.current }
        }}
        onPointerMove={(event) => {
          const operation = drag.current
          if (!operation || operation.id !== event.pointerId) return
          const next = clamp(Math.min(maxVisible, operation.width + event.clientX - operation.x))
          widthRef.current = next; setWidth(next)
        }}
        onPointerUp={(event) => {
          if (drag.current?.id !== event.pointerId) return
          drag.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
          void persistWidth(widthRef.current)
        }}
        onPointerCancel={() => {
          if (!drag.current) return
          widthRef.current = drag.current.previous; setWidth(drag.current.previous); drag.current = null
        }}
        onLostPointerCapture={() => {
          if (!drag.current) return
          widthRef.current = drag.current.previous; setWidth(drag.current.previous); drag.current = null
        }}
        onKeyDown={(event) => {
          let next = width
          if (event.key === 'ArrowLeft') next -= 10
          else if (event.key === 'ArrowRight') next += 10
          else if (event.key === 'Home') next = NOTE_SIDEBAR.min
          else if (event.key === 'End') next = Math.min(NOTE_SIDEBAR.max, maxVisible)
          else return
          event.preventDefault(); next = clamp(next); setWidth(next); void persistWidth(next)
        }}
        sx={{ width: 6, flexShrink: 0, cursor: 'col-resize', touchAction: 'none', bgcolor: vscodeColors.border,
          '&:hover, &:focus-visible': { bgcolor: vscodeColors.focusBorder } }} />
      <Box component="section" aria-label="ノート編集" sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        {selected ? <NoteEditor key={selected.id} note={selected} /> : null}
      </Box>
    </Box>
  )
}
