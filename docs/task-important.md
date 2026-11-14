# Task importance (047)

SQLite tasks.important is INTEGER boolean, NOT NULL DEFAULT false (0). Existing rows and new
tasks start false. Favorite is independent. Main validates UUID and an explicit boolean target,
checks row visibility, updates only important and updated_at in a transaction, and returns the
whole TaskDto. Repeating the same target does not update timestamps. All task DTOs include it.

Both Standard (two-line) and Compact (one-line) rows place SquareExclamationPoint immediately
left of title. Enabled: #ff6b6b, 3px stroke; disabled: #707070, 1.25px stroke. Important titles are
800-weight, same red, underlined. Completed important titles retain strike-through too.
Controls stay in the portal outside listbox options and do not select/drag/open the task.
Row action optional fields preserve compatibility with custom/mock action implementations;
production useTaskRowActions always supplies the importance actions.

Importance uses the existing per-task save queue and a separate boolean latest-intent saver.
Failed saves show an error and revert desired state to persisted data. Draft confirmation runs
before toggling, so a title edit is not hidden when a task leaves the Important section.

Compact THE DAY begins with Important, then its existing Today/Tomorrow/Overdue sections.
Important includes every visible incomplete task marked important, regardless of due date.
It remains as an empty heading when there are no items. Normal Summary Review stays four panels.
Important tasks also remain in their date sections; counts in the status bar count unique IDs.
Important rows have separate DOM IDs, inline editing is list-scoped, and cross-section drag
requests deduplicate task IDs. The drag origin is scoped to its actual section.

The installed drizzle-kit generates migration SQL and metadata. The script verifies that only
one tasks column was added and no old column/table changed. It does not open a real user DB.
Tests use temporary databases. Migration applies on next app launch; back up the closed app DB.

TaskDto/TaskRow strongly require important. The script makes the false default explicit in old
complete task-shaped TypeScript test fixtures, using the TypeScript AST and contextual types;
it does not modify arbitrary partial task seeds or SQL result expectations. Changed fixture
files are reported. Existing hand-written raw SQL snapshots may need a targeted update if they
assert all columns; validation stops without committing if any such assertion fails.

No external dependency added. Typecheck, tests, app build, migration-shape check and diff-check
run before committing. No interactive Electron test is claimed.
