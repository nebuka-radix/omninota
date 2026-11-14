import { ChevronDown, ChevronRight } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'

const expanded = encodeURIComponent(renderToStaticMarkup(<ChevronDown size={16} color="#cccccc" strokeWidth={1.75} />)).replace(/'/g, '%27')
const collapsed = encodeURIComponent(renderToStaticMarkup(<ChevronRight size={16} color="#cccccc" strokeWidth={1.75} />)).replace(/'/g, '%27')
const css = `
.gtd-monaco-root .monaco-editor .codicon-folding-expanded::before,
.gtd-monaco-root .monaco-editor .codicon-folding-manual-expanded::before {
  content:'' !important; display:inline-block; width:16px; height:16px;
  background:center/16px 16px no-repeat url("data:image/svg+xml,${expanded}");
}
.gtd-monaco-root .monaco-editor .codicon-folding-collapsed::before,
.gtd-monaco-root .monaco-editor .codicon-folding-manual-collapsed::before {
  content:'' !important; display:inline-block; width:16px; height:16px;
  background:center/16px 16px no-repeat url("data:image/svg+xml,${collapsed}");
}`
export function FoldIconStyles() { return <style>{css}</style> }
