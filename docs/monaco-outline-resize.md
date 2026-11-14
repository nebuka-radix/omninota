# Resizable Monaco outline pane (055)

The outline's right edge has a 6px draggable separator. Minimum outline width is always
128px, including narrow containers. The old 220px maximum is removed for user resizing;
automatic initial width remains 28% up to 220px, now bounded below by 128px.
On a sufficient viewport, the maximum leaves 80px for the editor/preview workspace.
If the viewport cannot fit 128 + 6 + 80px, the body scrolls horizontally rather than shrinking
the outline below the requested minimum. With the outline closed, workspace sizing is unchanged.

Dragging right enlarges the outline, dragging left narrows it. Pointer capture keeps dragging
active outside the separator; cancellation restores the pre-drag preference. Arrow keys change
10px, Home/End use the visible limits, double click resets to automatic initial sizing.
The width is retained across outline close/reopen in the same MonacoEditor mount. It is not
stored in the database or restored across remounts/tab changes/application restart.
Window shrink clamps only visible width; it does not overwrite the preferred width.

The outline has its own outer-container measurement. Preview resizing continues to measure
only the editor/preview workspace, excluding outline and its separator. Native heading folding,
TOC navigation, font zoom, word wrap, table formatting and save behavior remain unchanged.
No dependency, database or IPC change. Unit tests cover layout bounds and preference retention;
interactive Electron pointer/scroll/focus behavior still needs verification.
