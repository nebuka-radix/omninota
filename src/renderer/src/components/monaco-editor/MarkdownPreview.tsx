import { useEffect, useId, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import DOMPurify from 'dompurify'

let mermaidModule: Promise<typeof import('mermaid')> | undefined
function getMermaid() {
  mermaidModule ??= import('mermaid').then((module) => {
    module.default.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'default',
      flowchart: { htmlLabels: false }, suppressErrorRendering: true
    })
    return module
  })
  return mermaidModule
}
let renderSequence = 0

function MermaidDiagram({ source }: { source: string }) {
  const instance = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [result, setResult] = useState<{ source: string; svg?: string; error?: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!source.trim()) return
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { default: mermaid } = await getMermaid()
          if (cancelled) return
          const valid = await mermaid.parse(source, { suppressErrors: true })
          if (!valid) throw new Error('Mermaidの構文を確認してください。')
          const { svg } = await mermaid.render(`gtd-mermaid-${instance}-${++renderSequence}`, source)
          const clean = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ['foreignObject', 'script', 'a', 'image'],
            FORBID_ATTR: ['href', 'xlink:href']
          })
          if (!cancelled) setResult({ source, svg: clean })
        } catch (error) {
          if (!cancelled) setResult({ source, error: error instanceof Error ? error.message : String(error) })
        }
      })()
    }, 200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [source, instance])
  if (!source.trim()) return <div className="gtd-mermaid-message">Mermaidの記述がありません</div>
  if (result?.source !== source) return <div role="status">図を描画中…</div>
  if (result.error) return <div role="alert" className="gtd-mermaid-error">{result.error}</div>
  return <div className="gtd-mermaid-diagram" role="img" aria-label="Mermaidの図" dangerouslySetInnerHTML={{ __html: result.svg ?? '' }} />
}

export function MarkdownPreview({ value }: { value: string }) {
  return (
    <article className="gtd-markdown-page" onClickCapture={(event) => {
      // Preview is read-only: do not navigate the Electron renderer to document links.
      if (event.target instanceof Element && event.target.closest('a')) event.preventDefault()
    }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
        components={{
          pre: ({ children }) => <div className="gtd-markdown-code-container">{children}</div>,
          code: ({ className, children }) => /(?:^|\s)language-mermaid(?:\s|$)/.test(className ?? '')
            ? <MermaidDiagram source={String(children).replace(/\n$/, '')} />
            : <code className={className}>{children}</code>,
          img: ({ alt }) => <span className="gtd-markdown-image-placeholder">[画像: {alt ?? ''}]</span>,
          a: ({ href, children }) => <a href={href} title={href}>{children}</a>
        }}>
        {value}
      </ReactMarkdown>
    </article>
  )
}
