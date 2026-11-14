import { useEffect, useRef, useState } from 'react'
import { Alert, Box, TextField, Typography } from '@mui/material'
import { NOTE_NAME_MAX_LENGTH, type NoteDto } from '../../../../shared/contracts/notes'
import { MonacoEditor } from '../../components/MonacoEditor'
import { applyTableEdits, markdownTableEdits } from '../../components/monaco-editor/markdown-tables'
import { useDraftGuard } from '../drafts/DraftGuard'
import { useNoteMutations } from './note-queries'

export function NoteEditor({ note }: { note: NoteDto }) {
  const { register } = useDraftGuard()
  const mutations = useNoteMutations()
  const [draft, setDraft] = useState({ name: note.name, description: note.description })
  const draftRef = useRef(draft)
  const saved = useRef({ name: note.name, description: note.description })
  const pending = useRef<Promise<boolean> | null>(null)
  const errorRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const changed = (next: typeof draft) => { draftRef.current = next; setDraft(next) }
  const dirty = () => draftRef.current.name !== saved.current.name || draftRef.current.description !== saved.current.description
  const save = (formattedBody?: string): Promise<boolean> => {
    if (pending.current) return pending.current
    if (formattedBody !== undefined) changed({ ...draftRef.current, description: formattedBody })
    const snapshot = { ...draftRef.current }
    const run = (async () => {
      setSaving(true)
      setError(null)
      errorRef.current = null
      try {
        if (!snapshot.name.trim() || snapshot.name.trim().length > NOTE_NAME_MAX_LENGTH) throw new Error('ノート名は1〜96文字で入力してください。')
        const description = formattedBody ?? applyTableEdits(snapshot.description, await markdownTableEdits(snapshot.description))
        if (draftRef.current.name !== snapshot.name || draftRef.current.description !== snapshot.description) throw new Error('整形中に本文が変更されました。もう一度保存してください。')
        changed({ ...snapshot, description })
        const result = await mutations.save.mutateAsync({ id: note.id, name: snapshot.name, description })
        saved.current = { name: result.name, description: result.description }
        changed(saved.current)
        return true
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught)
        errorRef.current = message
        setError(message)
        return false
      } finally { setSaving(false) }
    })()
    pending.current = run
    void run.finally(() => { if (pending.current === run) pending.current = null })
    return run
  }
  const latest = useRef({ save, dirty })
  latest.current = { save, dirty }
  useEffect(() => register({
    kind: 'note', targetId: String(note.id), isDirty: () => latest.current.dirty(),
    save: () => latest.current.save(),
    discard: () => { changed(saved.current); setError(null) },
    waitForSave: async () => { await pending.current }
  }), [register, note.id])
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', minWidth: 0 }} data-testid="note-editor"
      onKeyDownCapture={(event) => {
        // Monaco handles shortcuts inside its own root. Handle Cmd+S from the name field too.
        if (!(event.target instanceof Element) || event.target.closest('[data-testid="monaco-editor"]')) return
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.stopPropagation(); void save()
        }
      }}>
      <Box sx={{ p: 2, flexShrink: 0 }}>
        <TextField value={draft.name} label="Note name" size="small" fullWidth autoComplete="off"
          onChange={(event) => changed({ ...draftRef.current, name: event.target.value })}
          slotProps={{ htmlInput: { maxLength: NOTE_NAME_MAX_LENGTH, readOnly: saving, 'aria-label': 'ノート名' } }} />
        <Typography component="p" role="status" sx={{ m: 0, mt: 1, fontSize: 11, color: 'text.secondary' }}>
          {saving ? '保存中…' : dirty() ? '未保存の変更があります' : '保存済み'}
        </Typography>
      </Box>
      {error && <Alert severity="error" sx={{ mx: 2, mb: 2 }}>{error}</Alert>}
      <Box sx={{ flex: 1, minHeight: 0, minWidth: 0 }}>
        <MonacoEditor value={draft.description} onChange={(description) => changed({ ...draftRef.current, description })}
          onSave={async (description) => { if (!await save(description)) throw new Error(errorRef.current ?? '保存できませんでした。') }}
          height="100%" readOnly={saving} ariaLabel="ノート本文" />
      </Box>
    </Box>
  )
}
