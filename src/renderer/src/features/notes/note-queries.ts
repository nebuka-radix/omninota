import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { FavoriteNoteInput, NoteDto, RenameNoteInput, SaveNoteInput } from '../../../../shared/contracts/notes'
import { unwrapIpc } from '../../lib/ipc'
export const noteListKey = ['notes', 'list'] as const
export const noteListQueryOptions = queryOptions({ queryKey: noteListKey, queryFn: () => unwrapIpc(window.gtd.notes.list()) })
export const noteWidthQueryOptions = queryOptions({ queryKey: ['notes', 'sidebar-width'], queryFn: () => unwrapIpc(window.gtd.notes.getSidebarWidth()), staleTime: Infinity })
const sort = (notes: NoteDto[]) => notes.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedOn.localeCompare(a.updatedOn) || b.id - a.id)
export function useNoteMutations() {
  const client = useQueryClient()
  const accept = async (note: NoteDto) => {
    await client.cancelQueries({ queryKey: noteListKey })
    client.setQueryData<NoteDto[]>(noteListKey, (previous) => {
      const old = previous?.find((item) => item.id === note.id)
      const latest = old && old.updatedOn > note.updatedOn ? old : note
      return sort([...(previous ?? []).filter((item) => item.id !== note.id), latest].filter((item) => item.active))
    })
  }
  return {
    create: useMutation({ mutationFn: () => unwrapIpc(window.gtd.notes.create()), onSuccess: accept }),
    save: useMutation({ mutationFn: (input: SaveNoteInput) => unwrapIpc(window.gtd.notes.save(input)), onSuccess: accept }),
    rename: useMutation({ mutationFn: (input: RenameNoteInput) => unwrapIpc(window.gtd.notes.rename(input)), onSuccess: accept }),
    favorite: useMutation({ mutationFn: (input: FavoriteNoteInput) => unwrapIpc(window.gtd.notes.setFavorite(input)), onSuccess: accept })
  }
}
