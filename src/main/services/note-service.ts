import { NOTE_SIDEBAR, type FavoriteNoteInput, type NoteDto, type RenameNoteInput, type SaveNoteInput } from '../../shared/contracts/notes'
import type { NoteRepository } from '../repositories/note-repository'
import { SETTINGS_KEYS, type SettingsRepository } from '../repositories/settings-repository'
import { BusinessError } from './errors'
export type NoteService = {
  list(): NoteDto[]
  create(): NoteDto
  save(input: SaveNoteInput): NoteDto
  rename(input: RenameNoteInput): NoteDto
  setFavorite(input: FavoriteNoteInput): NoteDto
  getSidebarWidth(): number
  saveSidebarWidth(width: number): number
}
export function createNoteService(deps: { repository: NoteRepository; settings: SettingsRepository; now?: () => Date }): NoteService {
  const now = deps.now ?? (() => new Date())
  const missing = () => new BusinessError('NOT_FOUND', '対象のノートが見つかりません。')
  const find = (id: number) => {
    const note = deps.repository.find(id)
    if (!note) throw missing()
    return note
  }
  const timestamp = (previous: string) => new Date(Math.max(now().getTime(), Date.parse(previous) + 1)).toISOString()
  return {
    list: () => deps.repository.list(),
    create: () => deps.repository.create(now().toISOString()),
    save(input) {
      const previous = find(input.id)
      const name = input.name ?? previous.name
      if (previous.name === name && previous.description === input.description) return previous
      const row = deps.repository.save(input.id, name, input.description, timestamp(previous.updatedOn))
      if (!row) throw missing()
      return row
    },
    rename(input) {
      const previous = find(input.id)
      if (previous.name === input.name) return previous
      const row = deps.repository.rename(input.id, input.name, timestamp(previous.updatedOn))
      if (!row) throw missing()
      return row
    },
    setFavorite(input) {
      const previous = find(input.id)
      if (previous.favorite === input.favorite) return previous
      const row = deps.repository.setFavorite(input.id, input.favorite, timestamp(previous.updatedOn))
      if (!row) throw missing()
      return row
    },
    getSidebarWidth() {
      const raw = deps.settings.get(SETTINGS_KEYS.noteSidebarWidth)?.value
      if (raw === undefined) return NOTE_SIDEBAR.default
      try {
        const value: unknown = JSON.parse(raw)
        return typeof value === 'number' && Number.isFinite(value)
          ? Math.min(NOTE_SIDEBAR.max, Math.max(NOTE_SIDEBAR.min, Math.round(value))) : NOTE_SIDEBAR.default
      } catch { return NOTE_SIDEBAR.default }
    },
    saveSidebarWidth(width) {
      deps.settings.upsert({ key: SETTINGS_KEYS.noteSidebarWidth, value: JSON.stringify(width), updatedAt: now().toISOString() })
      return width
    }
  }
}
