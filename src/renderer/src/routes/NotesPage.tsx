import { Alert, Box, CircularProgress } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { noteListQueryOptions } from '../features/notes/note-queries'
import { NoteEditor } from '../features/notes/NoteEditor'
import { useNotesSelection } from '../features/notes/NotesContext'

export function NotesPage() {
  const { selectedId } = useNotesSelection()
  const notes = useQuery(noteListQueryOptions)
  // No selection: render no Monaco editor or internal sidebar.
  if (selectedId === null) return null
  if (notes.data === undefined) {
    if (notes.isError) return <Alert severity="error">{notes.error.message}</Alert>
    return <Box role="status" aria-label="ノートを読み込み中" sx={{ p: 2 }}><CircularProgress size={16} /></Box>
  }
  const selected = notes.data.find((note) => note.id === selectedId && note.active)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 }}>
      {notes.isError && <Alert severity="error">{notes.error.message}</Alert>}
      <Box sx={{ flex: 1, minHeight: 0, minWidth: 0 }}>
        {selected ? <NoteEditor key={selected.id} note={selected} /> : null}
      </Box>
    </Box>
  )
}
