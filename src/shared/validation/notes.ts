import { z } from 'zod'
import { NOTE_NAME_MAX_LENGTH, NOTE_SIDEBAR } from '../contracts/notes'
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const notesListArgsSchema = z.tuple([])
export const notesCreateArgsSchema = z.tuple([])
export const notesSaveArgsSchema = z.tuple([z.strictObject({
  id, name: z.string().trim().min(1).max(NOTE_NAME_MAX_LENGTH), description: z.string().max(5_000_000)
})])
export const notesFavoriteArgsSchema = z.tuple([z.strictObject({ id, favorite: z.boolean() })])
export const notesGetSidebarWidthArgsSchema = z.tuple([])
export const notesSaveSidebarWidthArgsSchema = z.tuple([z.number().int().min(NOTE_SIDEBAR.min).max(NOTE_SIDEBAR.max)])
