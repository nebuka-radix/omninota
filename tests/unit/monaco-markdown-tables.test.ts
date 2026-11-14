import { describe, expect, it } from 'vitest'
import { applyTableEdits, markdownTableEdits } from '../../src/renderer/src/components/monaco-editor/markdown-tables'

const format = async (source: string) => applyTableEdits(source, await markdownTableEdits(source))

describe('Monaco Markdown table formatting', () => {
  it('formats a table without changing surrounding prose', async () => {
    const before = '#  Keep  heading\n\n**keep**  spaces\n\n'
    const after = '\n\nEnd  text\n'
    const table = '| A | B |\n| --- | --- |\n| longer | x |'
    const result = await format(before + table + after)
    expect(result.startsWith(before)).toBe(true)
    expect(result.endsWith(after)).toBe(true)
    expect(result).toContain('| A      | B   |')
  })
  it('does not format tables inside a code fence or mermaid', async () => {
    const source = '```markdown\n| A | B |\n| --- | --- |\n| x | y |\n```\n\n```mermaid\nflowchart LR\nA --> B\n```\n'
    expect(await format(source)).toBe(source)
  })
  it('preserves pipe characters in ordinary text', async () => {
    const source = 'one | two\n\ntext\n'
    expect(await format(source)).toBe(source)
  })
  it('formats multiple tables and is idempotent', async () => {
    const table = '| A | B |\n| --- | --- |\n| longer | x |'
    const result = await format(table + '\n\nMiddle\n\n' + table)
    expect(await format(result)).toBe(result)
    expect(result).toContain('\n\nMiddle\n\n')
    expect(result.endsWith('\n')).toBe(false)
  })
  it('preserves CRLF in the document', async () => {
    const source = 'Header\r\n\r\n| A | B |\r\n| --- | --- |\r\n| longer | x |\r\n'
    const result = await format(source)
    expect(result.replace(/\r\n/g, '')).not.toContain('\n')
    expect(result.startsWith('Header\r\n\r\n')).toBe(true)
    expect(result.endsWith('\r\n')).toBe(true)
  })
  it('does not rewrite nested tables in block quotes', async () => {
    const source = '> | A | B |\n> | --- | --- |\n> | longer | x |\n'
    expect(await format(source)).toBe(source)
  })
})
