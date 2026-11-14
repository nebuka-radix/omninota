import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NOTE_NAME_MAX_LENGTH, type NoteDto } from '../../../../shared/contracts/notes'
import { useDraftGuard } from '../drafts/DraftGuard'
import { useNoteMutations } from './note-queries'

export function InlineNoteName({ note, onDone }: { note: NoteDto; onDone: (restoreFocus: boolean) => void }) {
  const { register } = useDraftGuard()
  const { rename } = useNoteMutations()
  const [value, setValue] = useState(note.name)
  const valueRef = useRef(note.name)
  const baseline = useRef(note.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const pending = useRef<Promise<boolean> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const save = (restoreFocus = false): Promise<boolean> => {
    if (pending.current) return pending.current
    const name = valueRef.current.trim()
    const work = (async () => {
      if (!name || name.length > NOTE_NAME_MAX_LENGTH) {
        setError('ノート名は1〜96文字で入力してください。')
        inputRef.current?.focus({ preventScroll: true })
        return false
      }
      if (name === baseline.current) { doneRef.current(restoreFocus); return true }
      setBusy(true)
      setError(null)
      try {
        const result = await rename.mutateAsync({ id: note.id, name })
        baseline.current = result.name
        valueRef.current = result.name
        if (mounted.current) { setValue(result.name); doneRef.current(restoreFocus) }
        return true
      } catch (caught) {
        if (mounted.current) {
          setError(caught instanceof Error ? caught.message : String(caught))
          inputRef.current?.focus({ preventScroll: true })
        }
        return false
      } finally { if (mounted.current) setBusy(false) }
    })()
    pending.current = work
    void work.finally(() => { if (pending.current === work) pending.current = null })
    return work
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.select()
  }, [note.id])
  useEffect(() => {
    mounted.current = true
    const unregister = register({
      kind: 'note', targetId: `note-name:${note.id}`,
      isDirty: () => valueRef.current.trim() !== baseline.current,
      save: () => saveRef.current(false),
      discard: () => { valueRef.current = baseline.current; doneRef.current(false) },
      waitForSave: async () => { await pending.current }
    })
    return () => { mounted.current = false; unregister() }
  }, [register, note.id])
  return (
    <div style={{ flex: 1, minWidth: 0, paddingRight: 4, paddingTop: 2, paddingBottom: 2 }}>
      <input ref={inputRef} value={value} maxLength={NOTE_NAME_MAX_LENGTH} readOnly={busy}
        aria-label="ノート名を編集" aria-invalid={Boolean(error)} aria-describedby={error ? `note-rename-error-${note.id}` : undefined}
        autoComplete="off" spellCheck={false}
        onChange={(event) => { valueRef.current = event.target.value; setValue(event.target.value); setError(null) }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Enter' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !event.shiftKey)) {
            event.preventDefault(); event.stopPropagation(); void save(true)
          } else if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation()
            if (!pending.current) { valueRef.current = baseline.current; doneRef.current(true) }
          }
        }}
        style={{ width: '100%', minWidth: 0, height: 26, boxSizing: 'border-box', padding: '2px 4px',
          font: 'inherit', fontSize: 13, color: '#eeeeee', background: '#1e1e1e', border: '1px solid #007fd4',
          borderRadius: 2, userSelect: 'text' }} />
      {error && <div id={`note-rename-error-${note.id}`} role="alert" style={{ fontSize: 11, color: '#ffb4ab', overflowWrap: 'anywhere' }}>{error}</div>}
    </div>
  )
}
