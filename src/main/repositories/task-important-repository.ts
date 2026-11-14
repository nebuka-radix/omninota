import { and, eq, isNull } from 'drizzle-orm'
import type { AppDatabase } from '../db/client'
import { tasks, type TaskRow } from '../db/schema'
export type TaskImportantRepository = {
  find(id: string): TaskRow | undefined
  update(id: string, important: boolean, at: string): TaskRow | undefined
}
export function createTaskImportantRepository(db: AppDatabase): TaskImportantRepository {
  const visible = (id: string) => and(eq(tasks.id, id), isNull(tasks.hiddenAt))
  return {
    find: (id) => db.select().from(tasks).where(visible(id)).get(),
    update: (id, important, at) => db.update(tasks).set({ important, updatedAt: at }).where(visible(id)).returning().get()
  }
}
