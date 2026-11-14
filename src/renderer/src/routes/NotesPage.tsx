import { Alert, Box, CircularProgress } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { noteListQueryOptions, noteWidthQueryOptions } from '../features/notes/note-queries'
import { NoteWorkspace } from '../features/notes/NoteWorkspace'

export function NotesPage() {
  const notes = useQuery(noteListQueryOptions)
  const width = useQuery(noteWidthQueryOptions)
  if (notes.data === undefined || width.data === undefined) {
    if (notes.isError || width.isError) return <Alert severity="error">{notes.error?.message ?? width.error?.message}</Alert>
    return <Box role="status" aria-label="ノートを読み込み中" sx={{ p: 2 }}><CircularProgress size={16} /></Box>
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {(notes.isError || width.isError) && <Alert severity="error">{notes.error?.message ?? width.error?.message}</Alert>}
      <Box sx={{ flex: 1, minHeight: 0 }}><NoteWorkspace notes={notes.data} initialWidth={width.data} /></Box>
    </Box>
  )
}
