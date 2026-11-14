import { describe, expect, it } from 'vitest'
import { markdownHeadings, markdownHeadingRanges } from '../../src/renderer/src/components/monaco-editor/markdown-headings'
import { alignTableDisplayWidth, markdownDisplayWidth, splitMarkdownTableRow } from '../../src/renderer/src/components/monaco-editor/table-display-width'
import { applyTableEdits, markdownTableEdits } from '../../src/renderer/src/components/monaco-editor/markdown-tables'

const columns = (line: string) => Array.from(line.matchAll(/\|/g), (match) => markdownDisplayWidth(line.slice(0, match.index)))
describe('Markdown heading outline and folding', () => {
  it('folds through descendants until the next peer or ancestor', () => {
    const source = '# A\nbody\n## B\nchild\n### C\ntext\n## D\ntext\n# E'
    expect(markdownHeadings(source)).toEqual([
      { line: 1, endLine: 8, level: 1, title: 'A' },
      { line: 3, endLine: 6, level: 2, title: 'B' },
      { line: 5, endLine: 6, level: 3, title: 'C' },
      { line: 7, endLine: 8, level: 2, title: 'D' },
      { line: 9, endLine: 9, level: 1, title: 'E' }
    ])
    expect(markdownHeadingRanges(source)).not.toContainEqual({ start: 9, end: 9 })
  })
  it('ignores headings in code fences and block quotes', () => {
    const source = '# Real\n```mermaid\n# Not a heading\n```\n> # Quoted\n\n## Child'
    expect(markdownHeadings(source).map((heading) => heading.title)).toEqual(['Real', 'Child'])
  })
  it('supports setext headings, level six, CRLF and plain outline labels', () => {
    const source = 'Title\r\n=====\r\n\r\n###### **Bold** [Link](https://example.test) `code`'
    expect(markdownHeadings(source).map(({ line, level, title }) => ({ line, level, title }))).toEqual([
      { line: 1, level: 1, title: 'Title' }, { line: 4, level: 6, title: 'Bold Link code' }
    ])
  })
})
describe('display-width-aware Markdown tables', () => {
  it('counts CJK as two columns and combining sequences as one', () => {
    expect(markdownDisplayWidth('日本')).toBe(4)
    expect(markdownDisplayWidth('ABC')).toBe(3)
    expect(markdownDisplayWidth('e\u0301')).toBe(1)
  })
  it('aligns pipes for mixed Japanese and ASCII content', () => {
    const source = '| 名前 | Status |\n| --- | --- |\n| 山田太郎 | Open |\n| A | Done |'
    const result = alignTableDisplayWidth(source)
    const positions = result.split('\n').map(columns)
    for (const position of positions) expect(position).toEqual(positions[0])
    expect(alignTableDisplayWidth(result)).toBe(result)
  })
  it('preserves escaped pipes and delimiter alignment markers', () => {
    const source = '| Key | 値 |\n| :--- | ---: |\n| a\\|b | 日本語 |'
    const result = alignTableDisplayWidth(source)
    expect(splitMarkdownTableRow(result.split('\n')[2]!)).toEqual(['a\\|b', '日本語'])
    expect(splitMarkdownTableRow(result.split('\n')[1]!)[0]).toMatch(/^:-+$/)
    expect(splitMarkdownTableRow(result.split('\n')[1]!)[1]).toMatch(/^-+:$/)
  })
  it('preserves CRLF and does not modify non-table text', () => {
    const result = alignTableDisplayWidth('| 名前 | B |\r\n| --- | --- |\r\n| 日本語 | x |\r\n')
    expect(result.replace(/\r\n/g, '')).not.toContain('\n')
    expect(result.endsWith('\r\n')).toBe(true)
    expect(alignTableDisplayWidth('普通の文章')).toBe('普通の文章')
  })
  it('integrates with save formatting while preserving surrounding text', async () => {
    const before = '#  Keep  heading\n\n'
    const after = '\n\nKeep  spaces\n'
    const source = before + '| 名前 | B |\n| --- | --- |\n| 日本語 | x |' + after
    const result = applyTableEdits(source, await markdownTableEdits(source))
    expect(result.startsWith(before)).toBe(true)
    expect(result.endsWith(after)).toBe(true)
    expect(applyTableEdits(result, await markdownTableEdits(result))).toBe(result)
    const tableLines = result.slice(before.length, -after.length).split('\n')
    for (const position of tableLines.map(columns)) expect(position).toEqual(columns(tableLines[0]!))
  })
})
