# Compact tab keyboard navigation (054)

Ctrl+PageDown selects the next compact tab; Ctrl+PageUp selects the previous tab.
Order is derived from the labels object, currently THE DAY, INBOX, PROJECT, NOTE.
Navigation wraps between the first and last tab. Cmd is not a substitute for Ctrl.

A window capture listener exists only while CompactScreen is mounted, so shortcuts work
from task inputs, the app toolbar/status area, and the NOTE Monaco editor. It is removed
on unmount; standard-mode keyboard behavior is unchanged. Plain PageUp/PageDown and
combinations with additional Shift/Alt/Meta are not handled. IME composition is ignored.

Recognized shortcuts are consumed before child editor/list handlers. Visible dialogs and
alertdialogs suppress switching. The current changeTab function handles unsaved confirmation,
in-flight switching and errors, exactly as for mouse tab selection. No database/IPC or
native menu accelerator is added. This change does not alter tab selection persistence.

Pure unit tests cover key recognition and cyclic order; Electron dialog/focus/IME behavior
still requires interactive verification. The script runs typecheck/tests/build/diff-check.
