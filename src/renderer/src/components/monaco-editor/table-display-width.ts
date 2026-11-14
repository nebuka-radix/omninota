import stringWidth from 'string-width'

export const markdownDisplayWidth = (value: string): number => stringWidth(value)

// GFM separators are unescaped pipes; preserve raw escapes and inline Markdown source.
export function splitMarkdownTableRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let backslashes = 0
  for (const character of line.trim()) {
    if (character === '\\') { current += character; backslashes++; continue }
    if (character === '|' && backslashes % 2 === 0) { cells.push(current.trim()); current = '' }
    else current += character
    backslashes = 0
  }
  cells.push(current.trim())
  if (cells.length > 1 && cells[0] === '') cells.shift()
  if (cells.length > 1 && cells[cells.length - 1] === '') cells.pop()
  return cells
}

export function alignTableDisplayWidth(source: string): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const trailingNewline = /\r?\n$/.test(source)
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  if (trailingNewline) lines.pop()
  if (lines.length < 2) return source
  const rows = lines.map(splitMarkdownTableRow)
  const header = rows[0]!
  const markers = rows[1]!
  if (!header.length || markers.length !== header.length || markers.some((cell) => !/^:?-+:?$/.test(cell))) return source
  const count = header.length
  const alignments = markers.map((cell) => cell.startsWith(':') && cell.endsWith(':') ? 'center'
    : cell.endsWith(':') ? 'right' : 'left')
  const widths = header.map((_cell, column) => {
    const colons = Number(markers[column]!.startsWith(':')) + Number(markers[column]!.endsWith(':'))
    return rows.reduce((width, row, index) => index === 1 ? width : Math.max(width, markdownDisplayWidth(row[column] ?? '')), 3 + colons)
  })
  const result = rows.map((row, index) => '| ' + Array.from({ length: count }, (_unused, column) => {
    const width = widths[column]!
    if (index === 1) {
      const marker = markers[column]!
      const left = marker.startsWith(':') ? ':' : ''
      const right = marker.endsWith(':') ? ':' : ''
      return left + '-'.repeat(width - left.length - right.length) + right
    }
    const content = row[column] ?? ''
    const padding = Math.max(0, width - markdownDisplayWidth(content))
    const before = alignments[column] === 'right' ? padding : alignments[column] === 'center' ? Math.floor(padding / 2) : 0
    return ' '.repeat(before) + content + ' '.repeat(padding - before)
  }).join(' | ') + ' |')
  return result.join(eol) + (trailingNewline ? eol : '')
}
