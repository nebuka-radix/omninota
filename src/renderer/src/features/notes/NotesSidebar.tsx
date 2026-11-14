import { useLayoutEffect, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, IconButton, List, ListItemButton, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Star } from 'lucide-react'
import type { NoteDto } from '../../../../shared/contracts/notes'
import { useDraftGuard } from '../drafts/DraftGuard'
import { vscodeColors } from '../../theme'
import { InlineNoteName } from './InlineNoteName'
import { noteListQueryOptions, useNoteMutations } from './note-queries'
import { useNotesSelection } from './NotesContext'
import { noteListScrollTop } from './note-list-scroll'

// This subtree stays mounted when collapsed, so inline name drafts are not discarded.
export function NotesSidebar({ pathname, expanded }: { pathname: string; expanded: boolean }) {
  const notesQuery = useQuery(noteListQueryOptions)
  const notes = notesQuery.data ?? []
  const { selectedId, selectNote } = useNotesSelection()
  const { confirmLeave } = useDraftGuard()
  const navigate = useNavigate()
  const mutations = useNoteMutations()
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const listRef = useRef<HTMLUListElement>(null)
  useLayoutEffect(() => {
    if (!expanded || selectedId === null) return
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>(`[data-note-id="${selectedId}"]`)
    if (!list || !row) return
    const outer = list.getBoundingClientRect()
    const inner = row.getBoundingClientRect()
    list.scrollTop = noteListScrollTop(list.scrollTop, list.clientHeight, inner.top - outer.top, inner.bottom - outer.top)
  }, [selectedId, renamingId, notes.length, expanded])

  const select = async (id: number) => {
    if (busy.current || (id === selectedId && pathname === '/notes')) return
    busy.current = true
    setPending(true)
    try {
      if (!await confirmLeave()) return
      setError(null)
      await navigate({ to: '/notes' })
      setRenamingId(null)
      selectNote(id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { busy.current = false; setPending(false) }
  }
  const create = async () => {
    if (busy.current) return
    busy.current = true
    setPending(true)
    try {
      if (!await confirmLeave()) return
      setError(null)
      const note = await mutations.create.mutateAsync()
      await navigate({ to: '/notes' })
      selectNote(note.id)
      setRenamingId(note.id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { busy.current = false; setPending(false) }
  }
  const favorite = async (note: NoteDto) => {
    if (busy.current) return
    busy.current = true
    setPending(true)
    try {
      setError(null)
      await mutations.favorite.mutateAsync({ id: note.id, favorite: !note.favorite })
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { busy.current = false; setPending(false) }
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ flexShrink: 0, bgcolor: vscodeColors.sideBarBackground }}>
        <Button onClick={() => void create()} disabled={pending || notesQuery.data === undefined}
          data-testid="new-note" sx={{ width: '100%', height: 32, justifyContent: 'flex-start', pl: 8, pr: 2,
            color: '#ffffff', fontSize: 12, fontWeight: 600, textTransform: 'none', whiteSpace: 'nowrap' }}>
          + NEW NOTE
        </Button>
      </Box>
      {(error || notesQuery.isError) && <Alert severity="error" sx={{ mx: 1, flexShrink: 0 }}>
        {error ?? notesQuery.error?.message}
      </Alert>}
      {notesQuery.isPending && <Box role="status" aria-label="ノートを読み込み中" sx={{ p: 2 }}><CircularProgress size={14} /></Box>}
      <List ref={listRef} aria-label="NOTE LIST" data-testid="navigation-note-list"
        sx={{ m: 0, p: 0, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }}
        onKeyDown={(event) => {
          if (event.key !== 'F2' || event.nativeEvent.isComposing || event.target instanceof HTMLInputElement) return
          if (selectedId === null || pathname !== '/notes' || busy.current || !notes.some((note) => note.id === selectedId)) return
          event.preventDefault(); event.stopPropagation(); setRenamingId(selectedId)
        }}>
        {notes.map((note) => {
          const selected = pathname === '/notes' && note.id === selectedId
          return (
            <Box component="li" key={note.id} data-note-id={note.id} sx={{ display: 'flex', alignItems: 'center', pl: 4, pr: 1,
              bgcolor: selected ? vscodeColors.listActiveSelection : 'transparent', minWidth: 0 }}>
              <IconButton aria-label={`${note.name}のお気に入りを${note.favorite ? '解除' : '設定'}`} aria-pressed={note.favorite}
                disabled={pending} onClick={() => void favorite(note)}
                sx={{ width: 28, height: 30, flexShrink: 0, color: note.favorite ? '#e2c541' : 'text.secondary' }}>
                <Star size={15} fill={note.favorite ? '#e2c541' : 'none'} aria-hidden />
              </IconButton>
              {renamingId === note.id ? <InlineNoteName key={note.id} note={note} onDone={(restoreFocus) => {
                setRenamingId(null)
                if (restoreFocus) requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-note-id="${note.id}"] [data-note-select]`)?.focus({ preventScroll: true }))
              }} /> : <ListItemButton component="button" data-note-select selected={selected}
                onClick={() => void select(note.id)} aria-current={selected ? 'page' : undefined}
                sx={{ flex: 1, minWidth: 0, height: 30, p: 0, pr: 1, textAlign: 'left' }}>
                <Typography component="span" noWrap title={note.name} sx={{ fontSize: 13, minWidth: 0 }}>{note.name}</Typography>
              </ListItemButton>}
            </Box>
          )
        })}
      </List>
    </Box>
  )
}
