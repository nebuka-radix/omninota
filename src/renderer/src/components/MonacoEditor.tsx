import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { FileCodeCorner, Save } from 'lucide-react'
import type * as Monaco from 'monaco-editor'
import { markdownTableEdits } from './monaco-editor/markdown-tables'
import './monaco-editor/monaco-editor.css'

const Preview = lazy(() => import('./monaco-editor/MarkdownPreview').then((module) => ({ default: module.MarkdownPreview })))

export type MonacoEditorProps = {
  value: string
  onChange: (value: string) => void
  onSave: (value: string) => void | Promise<void>
  height?: number | string
  initialFontSize?: number
  readOnly?: boolean
  wordWrap?: boolean
  ariaLabel?: string
}

export function MonacoEditor({
  value, onChange, onSave, height = 320, initialFontSize = 12,
  readOnly = false, wordWrap = false, ariaLabel = 'Markdownエディタ'
}: MonacoEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const latest = useRef({ value, onChange, onSave, readOnly, wordWrap, ariaLabel })
  latest.current = { value, onChange, onSave, readOnly, wordWrap, ariaLabel }
  const mounted = useRef(false)
  const busyRef = useRef(false)
  const composing = useRef(false)
  const synchronizing = useRef(false)
  const runRef = useRef<(save: boolean) => Promise<void>>(async () => {})
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewValue, setPreviewValue] = useState(value)
  const [fontSize, setFontSize] = useState(() => Math.min(32, Math.max(10, Math.round(initialFontSize))))
  const previewId = `monaco-preview-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  runRef.current = async (save) => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model || busyRef.current || composing.current || latest.current.readOnly) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const version = model.getVersionId()
      const edits = await markdownTableEdits(model.getValue())
      if (!mounted.current || model.isDisposed() || editorRef.current !== editor) return
      if (version !== model.getVersionId() || composing.current || latest.current.readOnly) {
        throw new Error('整形中に本文が変更されたため、処理を中止しました。もう一度実行してください。')
      }
      if (edits.length) {
        editor.pushUndoStop()
        editor.executeEdits('markdown-table-format', edits.map((edit) => {
          const from = model.getPositionAt(edit.start)
          const to = model.getPositionAt(edit.end)
          return {
            range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column },
            text: edit.text, forceMoveMarkers: true
          }
        }))
        editor.pushUndoStop()
      }
      if (save) await latest.current.onSave(model.getValue())
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    let cleanup: (() => void) | undefined
    void import('./monaco-editor/setup').then(({ setupMonaco, LANGUAGE_ID, THEME_ID }) => {
      if (cancelled || !hostRef.current) return
      const monaco = setupMonaco()
      const model = monaco.editor.createModel(latest.current.value, LANGUAGE_ID)
      const editor = monaco.editor.create(hostRef.current, {
        model, theme: THEME_ID, automaticLayout: true,
        lineNumbers: 'on', lineNumbersMinChars: 2, glyphMargin: false,
        minimap: { enabled: false }, scrollBeyondLastLine: false,
        fontSize: Math.min(32, Math.max(10, Math.round(initialFontSize))),
        tabSize: 2, insertSpaces: true, detectIndentation: false,
        wordWrap: latest.current.wordWrap ? 'on' : 'off',
        readOnly: latest.current.readOnly, ariaLabel: latest.current.ariaLabel,
        mouseWheelZoom: false, formatOnPaste: false, formatOnType: false,
        quickSuggestions: false, padding: { top: 6, bottom: 6 }
      })
      editorRef.current = editor
      const subscription = editor.onDidChangeModelContent(() => {
        if (!synchronizing.current) latest.current.onChange(editor.getValue())
      })
      const host = hostRef.current
      const wheel = (event: WheelEvent) => {
        if (!event.ctrlKey || event.deltaY === 0) return
        event.preventDefault()
        event.stopImmediatePropagation()
        setFontSize((current) => Math.min(32, Math.max(10, current + (event.deltaY < 0 ? 1 : -1))))
      }
      host.addEventListener('wheel', wheel, { capture: true, passive: false })
      setReady(true)
      cleanup = () => {
        host.removeEventListener('wheel', wheel, true)
        subscription.dispose()
        editor.dispose()
        model.dispose()
        if (editorRef.current === editor) editorRef.current = null
      }
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
    })
    return () => { cancelled = true; mounted.current = false; cleanup?.() }
    // Creation options are initial values; live options are synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model || model.getValue() === value) return
    synchronizing.current = true
    try {
      editor.pushUndoStop()
      editor.executeEdits('external-value', [{ range: model.getFullModelRange(), text: value }])
      editor.pushUndoStop()
    } finally { synchronizing.current = false }
  }, [value, ready])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, readOnly, wordWrap: wordWrap ? 'on' : 'off', ariaLabel })
  }, [fontSize, readOnly, wordWrap, ariaLabel, ready])

  useEffect(() => {
    if (!previewOpen) return
    const timer = window.setTimeout(() => setPreviewValue(value), 250)
    return () => window.clearTimeout(timer)
  }, [value, previewOpen])

  return (
    <div className="gtd-monaco-root" style={{ height }} data-testid="monaco-editor"
      onCompositionStart={() => { composing.current = true }}
      onCompositionEnd={() => { composing.current = false }}
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing || composing.current) return
        const key = event.key.toLowerCase()
        if ((event.metaKey || event.ctrlKey) && !event.altKey &&
          ((key === 's' && !event.shiftKey) || (key === 'f' && event.shiftKey))) {
          event.preventDefault()
          event.stopPropagation()
          void runRef.current(key === 's')
          return
        }
        if (event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey &&
          hostRef.current?.contains(event.target as Node)) {
          event.preventDefault()
          event.stopPropagation()
          if (latest.current.readOnly) return
          const editor = editorRef.current
          const selections = editor?.getSelections()
          if (!editor || !selections) return
          editor.pushUndoStop()
          editor.executeEdits('insert-two-spaces', selections.map((range) => ({ range, text: '  ', forceMoveMarkers: true })))
          editor.pushUndoStop()
        }
      }}>
      <div className="gtd-monaco-toolbar" role="toolbar" aria-label="エディタ操作">
        <div className="gtd-monaco-toolbar-left">
          <button type="button" aria-label="保存" title="保存 (⌘S)" disabled={!ready || busy || readOnly}
            onClick={() => { void runRef.current(true) }}>
            <Save size={16} aria-hidden />
          </button>
          <span className="gtd-monaco-status" role="status">{busy ? '処理中…' : ''}</span>
        </div>
        <button type="button" aria-label="Markdownプレビュー" title="Markdownプレビュー"
          aria-pressed={previewOpen} aria-expanded={previewOpen} aria-controls={previewId}
          onClick={() => { setPreviewValue(editorRef.current?.getValue() ?? latest.current.value); setPreviewOpen((current) => !current) }}>
          <FileCodeCorner size={16} aria-hidden />
        </button>
      </div>
      {error && <div className="gtd-monaco-error" role="alert">{error}</div>}
      <div className="gtd-monaco-body">
        <div ref={hostRef} className="gtd-monaco-input" />
        {previewOpen && <aside id={previewId} className="gtd-monaco-preview" aria-label="Markdownプレビュー">
          <Suspense fallback={<div role="status">プレビューを読み込み中…</div>}>
            <Preview value={previewValue} />
          </Suspense>
        </aside>}
      </div>
    </div>
  )
}

export default MonacoEditor
