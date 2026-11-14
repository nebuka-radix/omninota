import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
type NotesSelection = {
  selectedId: number | null
  selectNote: (id: number | null) => void
}
const NotesContext = createContext<NotesSelection | null>(null)
export function NotesProvider({ children }: { children: ReactNode }) {
  const [selectedId, selectNote] = useState<number | null>(null)
  const value = useMemo(() => ({ selectedId, selectNote }), [selectedId])
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>
}
export function useNotesSelection(): NotesSelection {
  const value = useContext(NotesContext)
  if (!value) throw new Error('useNotesSelection must be used inside NotesProvider')
  return value
}
