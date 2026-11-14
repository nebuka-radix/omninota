# Note list inline rename (043)

+ New Note is a fixed header outside the note list scrolling area. Only the list scrolls.
The right editor no longer has a Note name textbox. Select a note in the sub-sidebar and
press F2 while focus is in the list to edit its name inline. Enter (or Cmd+S in that input)
commits; Escape cancels. IME confirmation Enter does not submit the name.

New Note creates the persisted New Note record, selects it, scrolls only the list to reveal
the row, focuses the name input and selects its entire name. Cancelling naming keeps the
new note under New Note; it does not delete the record.

Renaming uses a dedicated notes:rename IPC operation that updates only name and updated_on.
The body editor saves description without name, so asynchronous body saves cannot revert a
successful rename. Existing clients can still optionally supply name in notes:save.
Name drafts use DraftGuard; leaving a changed name prompts for save/discard/cancel.
Blur alone does not silently save a name. Failed saves keep the input and error available.

TextWrap is immediately right of Save in the left toolbar group. Styling and toggle behavior
from 042 are retained. No database migration, new dependency, or width preference change.

Run typecheck, tests and build. Interactive focus, F2, list scrolling and Japanese IME behavior
must still be verified in Electron. The new integration test verifies field preservation.
