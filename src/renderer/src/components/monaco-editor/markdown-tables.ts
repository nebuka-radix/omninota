import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import * as prettier from 'prettier/standalone'
import * as markdownPlugin from 'prettier/plugins/markdown'
import { alignTableDisplayWidth } from './table-display-width'

export type TableEdit = { start: number; end: number; text: string }
const parser = unified().use(remarkParse).use(remarkGfm)

// Top-level GFM tables only: preserve all other source bytes, including fenced code.
export async function markdownTableEdits(source: string): Promise<TableEdit[]> {
  const root = parser.parse(source)
  const edits: TableEdit[] = []
  for (const node of root.children) {
    if (node.type !== 'table') continue
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) continue
    const original = source.slice(start, end)
    const formatted = await prettier.format(original, {
      parser: 'markdown', plugins: [markdownPlugin], proseWrap: 'preserve',
      embeddedLanguageFormatting: 'off', endOfLine: source.includes('\r\n') ? 'crlf' : 'lf'
    })
    const text = alignTableDisplayWidth(formatted.replace(/\r?\n$/, ''))
    if (text !== original) edits.push({ start, end, text })
  }
  return edits
}

export function applyTableEdits(source: string, edits: readonly TableEdit[]): string {
  return [...edits].sort((a, b) => b.start - a.start)
    .reduce((result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end), source)
}
