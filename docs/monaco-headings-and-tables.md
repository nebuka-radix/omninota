# Heading folding, outline, monospace and display-width tables (046)

Monaco's native FoldingRangeProvider supplies heading sections. A section ends immediately
before the next heading at the same or a higher level. Descendant sections are included.
Only root-level Markdown headings are used (ATX levels 1–6 and Setext); headings inside
code fences, Mermaid blocks, block quotes or list containers do not become outline entries.
The gutter beside line numbers always exposes native folding controls for foldable headings.
Native gutter interaction/state is retained; icon SVGs are rendered from Lucide ChevronDown
and ChevronRight, then used in scoped CSS for native folding icon classes.

TableOfContents follows Word Wrap beside Save. It toggles an internal left outline pane.
Indentation reflects heading depth. Clicking unfolds target ancestors and scrolls/focuses
Monaco at the heading; it does not save or change text. Outline and preview can coexist.
The outline takes 28% of the editor component (capped at 220px) and scrolls independently.
The outline is not an app/sidebar replacement. Toggle and folding state are not persisted.

Editor fontFamily: 'HackGen Console NF', Menlo, Monaco, 'Courier New', monospace.
fontLigatures is false. No fonts are downloaded or bundled by this script; installed fonts
and browser fallback determine actual glyph rendering. Preview keeps its MediaWiki-style font.

Prettier still formats valid top-level GFM tables first. A second pass aligns raw table source
by string-width display columns (CJK fullwidth = 2, narrow ASCII = 1, combining marks = 0).
This is not byte counting. Raw Markdown markers/URLs count because source pipes are aligned.
Delimiter colons and escaped pipes are retained. Non-table source and fenced code are untouched.
Emoji/ambiguous-character pixel widths can vary by installed font; Unicode display columns
cannot guarantee identical pixels for every fallback glyph. Ambiguous width uses narrow default.
Tables inside quotes/lists remain outside the original table-only formatting scope.

New renderer dependency: string-width@7, bundled locally. No database/schema/IPC change.
Tests cover heading ranges, fence exclusion, hierarchy, Japanese/ASCII display width, escaping,
CRLF, idempotence, and integration with existing table-only formatting.
The script runs typecheck/tests/build then commits. Native gutter icon placement, keyboard
folding and outline navigation must still be checked interactively in packaged Electron.
