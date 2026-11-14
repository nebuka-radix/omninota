import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

export const LANGUAGE_ID = 'gtd-markdown'
export const THEME_ID = 'gtd-markdown-dark'
let initialized = false

export function setupMonaco(): typeof monaco {
  if (initialized) return monaco
  initialized = true
  const environment = (globalThis as typeof globalThis & { MonacoEnvironment?: monaco.Environment })
  const previous = environment.MonacoEnvironment
  environment.MonacoEnvironment = {
    ...previous,
    getWorker: (workerId, label) => previous?.getWorker
      ? previous.getWorker(workerId, label)
      : new EditorWorker()
  }
  monaco.languages.register({ id: LANGUAGE_ID })
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }]
  })
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/^ {0,3}`{3,}.*$/, 'code', '@backtickFence'],
        [/^ {0,3}~{3,}.*$/, 'code', '@tildeFence'],
        [/^ {0,3}####(?=\s|$).*$/, 'heading4'],
        [/^ {0,3}###(?=\s|$).*$/, 'heading3'],
        [/^ {0,3}##(?=\s|$).*$/, 'heading2'],
        [/^ {0,3}#(?=\s|$).*$/, 'heading1'],
        [/``[^`]+``/, 'code'],
        [/`[^`]+`/, 'code'],
        [/\*\*[^*]+\*\*/, 'strong'],
        [/^\s*-\s+/, 'list'],
        [/\|/, 'table'],
        [/[^`*|]+/, ''],
        [/./, '']
      ],
      backtickFence: [[/^ {0,3}`{3,}\s*$/, 'code', '@pop'], [/.*$/, 'code']],
      tildeFence: [[/^ {0,3}~{3,}\s*$/, 'code', '@pop'], [/.*$/, 'code']]
    }
  })
  monaco.editor.defineTheme(THEME_ID, {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'heading1', foreground: '00FF00', fontStyle: 'bold underline' },
      { token: 'heading2', foreground: '00FFFF', fontStyle: 'bold underline' },
      { token: 'heading3', foreground: 'FF00FF', fontStyle: 'bold underline' },
      { token: 'heading4', foreground: 'FFA500', fontStyle: 'bold underline' },
      { token: 'strong', foreground: '1E90FF', fontStyle: 'bold' },
      { token: 'code', foreground: 'FFFF00' },
      { token: 'list', foreground: 'CCCCCC' },
      { token: 'table', foreground: 'CCCCCC' }
    ],
    colors: { 'editor.background': '#1e1e1e', 'editor.foreground': '#cccccc' }
  })
  return monaco
}
