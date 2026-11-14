# Main-sidebar Project and Note integration (044)

Fixed menu labels: SUMMARY REVIEW, INBOX, PROJECT, NOTE, SETTINGS.
User-created project/note names are unchanged. Routes and database names are unchanged.

PROJECT and NOTE headings are full-width disclosure buttons, not navigation links.
Clicking icon, title, or blank area toggles the section exactly once. Prefixes use
ChevronRight when collapsed and ChevronDown when expanded. There is no trailing icon.
Click a project or note item to navigate; use + NEW PROJECT / + NEW NOTE to create.
PROJECT initially remains collapsed. NOTE initially opens on the /notes route;
otherwise it initially remains collapsed. Expansion state is not saved.

Expanded sections share the remaining vertical sidebar space. Each list scrolls separately;
creation controls are outside those scrolling lists. + NEW PROJECT precedes the project list.
+ NEW NOTE is uppercase white text. The sidebar's existing workspace width persistence is used.

NotesPage no longer mounts NoteWorkspace or its internal sidebar/divider and never queries
noteSidebarWidth. It renders only the selected NoteEditor, or nothing when no note is selected.
The old NoteWorkspace module and width IPC/settings remain unused for compatibility; no data
is deleted, and the old noteSidebarWidth preference is not repurposed.

A NotesProvider within DraftGuardProvider shares selection between navigation and the page.
Favorite ordering, star toggling, F2 rename, Enter/Escape, automatic reveal/select-name on
creation, and independent name/body writes are retained. NotesSidebar stays mounted when
collapsed so name drafts stay registered with DraftGuard. Collapsing does not discard edits
or close the selected editor. Selection is not persisted across application restart.

044 adds no dependency or database migration. The script checks all patch anchors before
writing, runs typecheck/tests/build/diff-check, and commits only on success.
Unit tests cover fixed labels and list scrolling; no interactive Electron UI test is run.
