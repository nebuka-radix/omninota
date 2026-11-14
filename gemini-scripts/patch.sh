#!/bin/zsh
set -euo pipefail
cd -- "${0:A:h:h}"
[[ -f package.json ]] || { print -u2 'プロジェクトルートを確認してください'; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null
if [[ -n "$(git status --porcelain --untracked-files=all -- . ':!gemini-scripts')" ]]; then
  print -u2 'gemini-scripts以外の未コミット変更を先に整理してください。'
  exit 1
fi
node <<'NODE'
const fs = require('node:fs');
const path = 'src/renderer/src/routes/SummaryPage.tsx';
const handlePath = 'src/renderer/src/features/summary/CompactSplitHandle.tsx';
const edits = [["import { Page } from '../components/Page'", "import { Page } from '../components/Page'\nimport { CompactSplitHandle } from '../features/summary/CompactSplitHandle'"], ["export function SummaryPage({ compact = false }: { compact?: boolean }) {", "export function SummaryPage({ compact = false }: { compact?: boolean }) {\n  const [compactTodayPercent, setCompactTodayPercent] = useState(50)"], ["gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',", "gridTemplateRows: compact\n              ? `minmax(0, ${compactTodayPercent}fr) minmax(0, ${100 - compactTodayPercent}fr)`\n              : 'minmax(0, 1fr) minmax(0, 1fr)',\n            position: 'relative',"], ["          {sections.map((section) => {", "          {compact && <CompactSplitHandle value={compactTodayPercent} onChange={setCompactTodayPercent} />}\n          {sections.map((section) => {"]];
let source = fs.readFileSync(path, 'utf8');
if (fs.existsSync(handlePath)) throw new Error(`既存ファイルは上書きしません: ${handlePath}`);
for (const [before, after] of edits) {
  if (source.split(before).length !== 2) throw new Error(`対象コードが一致しません。001〜003適用後のSummaryPage.tsxを確認してください: ${before}`);
  source = source.replace(before, after);
}
fs.writeFileSync(handlePath, "import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'\nimport { Box } from '@mui/material'\nimport { vscodeColors } from '../../theme'\n\ntype Drag = { pointerId: number; initial: number; element: HTMLDivElement }\n\n// Todayの占有率を変更する。寸法は操作ごとに測定し、ウィンドウの高さ変更にも追従する。\nexport function CompactSplitHandle({ value, onChange }: { value: number; onChange: (value: number) => void }) {\n  const dragRef = useRef<Drag | null>(null)\n  const changeRef = useRef(onChange)\n  changeRef.current = onChange\n\n  const clamp = (next: number, element: HTMLElement) => {\n    const height = element.parentElement?.getBoundingClientRect().height ?? 0\n    const minimum = height > 0 ? Math.min(45, Math.max(10, 64 / height * 100)) : 10\n    return Math.min(100 - minimum, Math.max(minimum, next))\n  }\n  const finish = (cancel: boolean) => {\n    const drag = dragRef.current\n    if (!drag) return\n    dragRef.current = null\n    if (cancel) changeRef.current(drag.initial)\n    if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)\n  }\n  useEffect(() => () => {\n    const drag = dragRef.current\n    dragRef.current = null\n    if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)\n  }, [])\n\n  const move = (event: PointerEvent<HTMLDivElement>) => {\n    const drag = dragRef.current\n    if (!drag || drag.pointerId !== event.pointerId) return\n    const rect = event.currentTarget.parentElement?.getBoundingClientRect()\n    if (!rect || rect.height <= 0) return\n    onChange(clamp((event.clientY - rect.top) / rect.height * 100, event.currentTarget))\n  }\n  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {\n    if (event.key === 'Escape' && dragRef.current) {\n      event.preventDefault()\n      event.stopPropagation()\n      finish(true)\n      return\n    }\n    if (dragRef.current) return\n    const step = event.shiftKey ? 10 : 2\n    const next = event.key === 'ArrowUp' ? value - step : event.key === 'ArrowDown' ? value + step : event.key === 'Home' ? 0 : event.key === 'End' ? 100 : null\n    if (next === null) return\n    event.preventDefault()\n    event.stopPropagation()\n    onChange(clamp(next, event.currentTarget))\n  }\n\n  return (\n    <Box\n      role=\"separator\"\n      aria-label=\"TodayとTomorrowの高さを変更\"\n      aria-orientation=\"horizontal\"\n      aria-valuemin={0}\n      aria-valuemax={100}\n      aria-valuenow={Math.round(value)}\n      aria-valuetext={`Today ${Math.round(value)}%、Tomorrow ${Math.round(100 - value)}%`}\n      tabIndex={0}\n      data-testid=\"compact-height-resizer\"\n      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {\n        if (event.button !== 0 || dragRef.current) return\n        event.preventDefault()\n        event.stopPropagation()\n        const element = event.currentTarget\n        element.focus()\n        element.setPointerCapture(event.pointerId)\n        dragRef.current = { pointerId: event.pointerId, initial: value, element }\n      }}\n      onPointerMove={move}\n      onPointerUp={(event: PointerEvent<HTMLDivElement>) => {\n        if (dragRef.current?.pointerId !== event.pointerId) return\n        move(event)\n        finish(false)\n      }}\n      onPointerCancel={() => finish(true)}\n      onLostPointerCapture={() => finish(true)}\n      onKeyDown={keyDown}\n      onDoubleClick={() => onChange(50)}\n      sx={{\n        position: 'absolute', left: 0, right: 0, top: `calc(${value}% - 4px)`, height: 8,\n        zIndex: 2, cursor: 'row-resize', touchAction: 'none', userSelect: 'none',\n        '&::after': { content: '\"\"', position: 'absolute', left: 0, right: 0, top: 3, height: 2, bgcolor: vscodeColors.gridLine },\n        '&:hover::after, &:focus-visible::after': { bgcolor: vscodeColors.focusBorder },\n        '&:focus-visible': { outline: `1px solid ${vscodeColors.focusBorder}`, outlineOffset: -1 }\n      }}\n    />\n  )\n}\n");
fs.writeFileSync(path, source);
console.log(`更新: ${path}`);
console.log(`追加: ${handlePath}`);
NODE
npm run typecheck
npm run build
git diff --check

git add .
git commit -m 'コンパクト表示のタスクリスト高さを調整可能にする'
