# THE DAY priority ordering (053)

Only compact SummaryPage (THE DAY) uses this presentation order:
- Important: important=true first, then favorite=true first. The existing Important filter
  already includes only important incomplete tasks, so favorite determines visible priority.
- Today, Tomorrow, Overdue: favorite=true first; important does not affect ordering.
- Equal priority: preserve the original section order. No ID/title/date tie-breaker is added.

The shared itemsOf function supplies the same order to rendering and drag/selection rows.
Source/query-cache arrays are not mutated. Importance filters, duplicate task representation,
unique status count, row colors and one-line mode remain unchanged. Normal Summary Review
and other tabs keep their previous ordering. No database, IPC or dependency change.
The script runs typecheck, tests, build and diff-check and commits only on success.
