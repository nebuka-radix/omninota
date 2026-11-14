# Compact NOTE tab (045)

Fourth compact tab: NOTE. Same 16px tab label and scrolling tab strip as other tabs.
Task registration and its destination label are hidden only while NOTE is selected.
NOTE has an internal resizable note sidebar and a right-side NotesPage editor.
No selection means no Monaco editor. NotesProvider shares selection with standard mode.

NotesSidebar is reused, including favorite/updated order, stars, uppercase white + NEW NOTE,
F2 rename, Enter/Escape, create/reveal/select-name, and independent name/body saves.
An embedded flag suppresses route navigation in compact mode and reduces indentation.
Standard mode's NotesSidebar keeps its previous navigation and spacing behavior.

Drag the sidebar's right border to resize. Default preferred width 220px, saved range
104–480px; minimum was reduced from 140px so the 240px compact window remains adjustable.
The existing notes sidebar width IPC and app_settings.noteSidebarWidth are reused.
This does not change standard mode's main sidebar width preference.
Preference is saved on pointer release (or keyboard resize), serialized, cached, and restored
on subsequent tab selection and subsequent app launch. No new table or migration is needed.

A narrow container can reduce visible width without overwriting the preference.
At a 240px container the divider is 6px, editor retains at least 80px, and the sidebar can
be adjusted from 104 to 154px. Larger containers respect the saved width up to 480px.
ArrowLeft/ArrowRight adjust 10px; Home/End use visible limits; cancelled drag restores width.

Tab/mode changes continue to use DraftGuard. Pending width saves are awaited; a failed
width save leaves an error and dirty preference rather than silently losing the change.
Unsaved note body/name drafts use their existing guards. No synthetic task is created on NOTE.
The script runs typecheck, tests, build and diff-check, then commits only on success.
Interactive Electron resize/focus/IME and restart verification remain necessary.
