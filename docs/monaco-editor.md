# MonacoEditor

Shared controlled Markdown editor at `src/renderer/src/components/MonacoEditor.tsx`.
This change does not place the component in an existing screen or change the database.

```tsx
import { useState } from 'react'
import { MonacoEditor } from './components/MonacoEditor'

function Example() {
  const [body, setBody] = useState('')
  return <MonacoEditor value={body} onChange={setBody}
    onSave={async (formattedBody) => {
      // Call the placement screen's actual save API with formattedBody.
      // Do not read a potentially stale body variable here.
    }} height={320} initialFontSize={12} />
}
```

- `value`, `onChange`, `onSave` are required. Parent owns dirty state and persistence.
- Save icon and Cmd+S format tables then call onSave. Cmd+Shift+F formats only.
- Ctrl+S / Ctrl+Shift+F also work on other platforms.
- Save errors are shown in the component. Dirty-state completion is the parent's responsibility.
- Tab inserts exactly two ASCII spaces, also replacing selected text. Shift+Tab retains Monaco's behavior.
- Line numbers are always visible. Word wrap defaults to false.
- Ctrl+wheel changes only the editor font by 1px, clamped to 10–32px. Default 12px. Size is not persisted.
- Preview toggle opens the internal right pane; it does not use the app's task detail pane.
- Preview updates after a short debounce; it does not save or format the document.
- Preview is MediaWiki-inspired CSS, not MediaWiki software or wikitext.
- Mermaid fenced blocks render as SVG, strict mode and DOMPurify sanitization; invalid/empty blocks have local messages.
- Raw HTML is disabled; preview links do not navigate, remote images are not fetched (alt text placeholder).
- No CDN or external font loads are configured. Libraries/worker are bundled locally by Vite.
- Model and editor are disposed on unmount. Text changes/formatting support Undo/Redo.
- Async formatting is discarded if the model changes while it is running.

## Highlighting

Heading lines # / ## / ### / ####: lime / cyan / magenta / orange, bold and underline.
Strong **text**: dodgerblue and bold. Inline backticks and fenced code: yellow.
Fenced code is not highlighted as headings or strong text. List markers and table pipes are recognized.
Inline code supports one or two backticks; multiline code uses standard triple-backtick or tilde fences.
No VS Code extensions are installed; this is a custom Monarch language for the requested palette.

## Table formatting scope

Only top-level valid GFM tables are formatted with Prettier. Other bytes are preserved.
Tables nested in block quotes or list items are left unchanged to avoid damaging container syntax.
Pipe-only text without a GFM delimiter row is not treated as a table.
Formatting aligns source text with spaces, not rendered HTML column widths.

## Validation

The installation script runs typecheck, unit tests, application build, and a standalone Vite
bundle smoke test that uses MonacoEditor.tsx as an entry (even though no screen imports it yet).
It then runs git diff --check and commits. This does not run an Electron interactive UI test.
Verify Japanese IME, Undo, shortcuts, wheel zoom, and Mermaid in a packaged app before release.
