import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

export type MarkdownHeading = { line: number; endLine: number; level: number; title: string }
type TextNode = { type: string; value?: string; alt?: string | null; children?: readonly TextNode[] }
const parser = unified().use(remarkParse).use(remarkGfm)
const textOf = (node: TextNode): string => node.type === 'break' ? ' '
  : node.value ?? node.alt ?? node.children?.map(textOf).join('') ?? ''

export function markdownHeadings(source: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = []
  const stack: MarkdownHeading[] = []
  const lastLine = source.split(/\r\n|\r|\n/).length
  for (const node of parser.parse(source).children) {
    if (node.type !== 'heading' || !node.position) continue
    const line = node.position.start.line
    while (stack.length && stack[stack.length - 1]!.level >= node.depth) stack.pop()!.endLine = line - 1
    const heading = { line, endLine: lastLine, level: node.depth, title: node.children.map(textOf).join('').trim() || '(見出し)' }
    headings.push(heading)
    stack.push(heading)
  }
  return headings
}
export function markdownHeadingRanges(source: string): { start: number; end: number }[] {
  return markdownHeadings(source).filter((heading) => heading.endLine > heading.line)
    .map((heading) => ({ start: heading.line, end: heading.endLine }))
}
