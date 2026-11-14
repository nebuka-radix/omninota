import { sql } from 'drizzle-orm'
import { check, customType, integer, sqliteTable } from 'drizzle-orm/sqlite-core'
const varchar96 = customType<{ data: string; driverData: string }>({ dataType: () => 'varchar(96)' })
const datetime = customType<{ data: string; driverData: string }>({ dataType: () => 'datetime' })
const textValue = customType<{ data: string; driverData: string }>({ dataType: () => 'text' })

// ISO 8601 UTC strings are used for datetime values, matching existing application timestamps.
export const notes = sqliteTable('note', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
  name: varchar96('name').notNull(),
  description: textValue('description').notNull().default(''),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdOn: datetime('created_on').notNull(),
  updatedOn: datetime('updated_on').notNull()
}, (table) => [
  check('note_name_length', sql`length(${table.name}) between 1 and 96`),
  check('note_favorite_boolean', sql`${table.favorite} in (0, 1)`),
  check('note_active_boolean', sql`${table.active} in (0, 1)`)
])
export type NoteRow = typeof notes.$inferSelect
