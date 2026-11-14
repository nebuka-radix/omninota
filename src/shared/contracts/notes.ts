export const NOTE_NAME_MAX_LENGTH = 96
export const NOTE_SIDEBAR = { default: 220, min: 104, max: 480 } as const
export type NoteDto = {
  id: number
  favorite: boolean
  name: string
  description: string
  active: boolean
  createdOn: string
  updatedOn: string
}
export type SaveNoteInput = { id: number; name?: string; description: string }
export type RenameNoteInput = { id: number; name: string }
export type FavoriteNoteInput = { id: number; favorite: boolean }
