# Notes (standard mode)

- Application sidebar: Project starts collapsed. Note menu follows the Project area.
- /notes is a workspace route and can be restored on next launch.
- The main panel contains a separate note list and a note editor.
- No selection on entering: MonacoEditor is not mounted until a note is selected.
- + New Note immediately creates and selects an active record named New Note.
- List order: favorite DESC, updated_on DESC, id DESC (tie-breaker).
- Star button toggles favorite; favorite uses yellow fill, others have no fill.
- Inline list rename (F2) is limited to 96 UTF-16 code units by the UI/IPC and must not be blank.
- Body uses MonacoEditor; save button / Cmd+S save formatted description. Name is saved separately by inline rename.
- Unsaved notes are registered with DraftGuard for selection, navigation, mode change and exit.
- Note list width is drag-resizable, stored in app_settings under noteSidebarWidth.
  Default 220px, allowed 140–480px. Arrow keys change 10px; Home/End set limits.
- Window resize can temporarily reduce visible width without changing the saved preference.
- Width writes are serialized and participate in DraftGuard's pending-save settlement.
- Existing app detail pane is hidden on /notes without changing its saved visibility preference.
  The Monaco preview is independent from that pane.
- Existing badges and compact-mode tabs are not changed.

## Database

New singular table note, columns:
id INTEGER PRIMARY KEY AUTOINCREMENT; favorite BOOLEAN (0/1, default false);
name VARCHAR(96); description TEXT; active BOOLEAN (0/1, default true);
created_on DATETIME; updated_on DATETIME.
All columns are non-null. description defaults to an empty string.
DATETIME values are ISO 8601 UTC strings. IDs are exposed as numbers.
Only active records are listed; no delete/deactivation menu is introduced in this change.
The new migration only creates note; no existing table or row is rewritten.
The script generates SQL and Drizzle snapshot/journal using the installed drizzle-kit,
then checks that the previous tables' snapshots are unchanged.

## Installation and verification

Run 041 only after 039/040 have passed and been committed. Stop the app first.
The script does not launch Electron or access the normal/development database.
The migration is applied by the existing startup migration mechanism on next launch.
Back up your database while the app is closed before that first launch.
Tests use temporary databases and include legacy migration/data retention checks.
No Electron visual test is performed by this script.
