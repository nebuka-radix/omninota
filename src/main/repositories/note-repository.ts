import { and, desc, eq } from 'drizzle-orm'
import type { AppDatabase } from '../db/client'
import { notes, type NoteRow } from '../db/schema'
export type NoteRepository = {
  list(): NoteRow[]
  find(id: number): NoteRow | undefined
  create(at: string): NoteRow
  save(id: number, name: string, description: string, at: string): NoteRow | undefined
  setFavorite(id: number, favorite: boolean, at: string): NoteRow | undefined
}
export function createNoteRepository(db: AppDatabase): NoteRepository {
  const activeId = (id: number) => and(eq(notes.id, id), eq(notes.active, true))
  return {
    list: () => db.select().from(notes).where(eq(notes.active, true))
      .orderBy(desc(notes.favorite), desc(notes.updatedOn), desc(notes.id)).all(),
    find: (id) => db.select().from(notes).where(activeId(id)).get(),
    create(at) {
      const row = db.insert(notes).values({ name: 'New Note', description: '', createdOn: at, updatedOn: at }).returning().get()
      if (!row) throw new Error('ノートを作成できませんでした')
      return row
    },
    save: (id, name, description, at) => db.update(notes).set({ name, description, updatedOn: at }).where(activeId(id)).returning().get(),
    setFavorite: (id, favorite, at) => db.update(notes).set({ favorite, updatedOn: at }).where(activeId(id)).returning().get()
  }
}
