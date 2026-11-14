# MonacoEditor interaction update

- macOS: Main calls systemPreferences.setUserDefault('ApplePressAndHoldEnabled', 'boolean', false)
  before window creation. Native repeat is used; there is no synthetic key injection or timer.
  Fully quit and restart the app after installing. Repeat delay/rate remain OS settings.
  This application-level native preference affects other text inputs in the same process too,
  not only Monaco. No defaults write -g command is run. In unbundled development, Electron's
  preference domain can be shared with other unbundled Electron apps.
- TextWrap icon is immediately right of the Save icon. ON: lime background and black icon.
  OFF: toolbar background and gray icon. It only changes editor word wrapping.
  Initial state uses the wordWrap prop (default false). Later changes to that prop synchronize it;
  user toggles are local and are not saved to the database.
- Preview left border is a draggable 6px separator with pointer capture.
  Drag left to enlarge preview; right to enlarge editor. ArrowLeft/ArrowRight adjust 10px;
  Home/End use limits; double click resets to half. Pointer cancellation restores initial ratio.
  Wide layout minimums: editor 120px, preview 160px. Narrow layout shrinks minimums to fit.
  Ratio survives preview close/reopen during this component mount, but not remount/app restart.
- ResizeObserver follows actual editor container width and Monaco automaticLayout remains enabled.
- Existing save shortcuts, formatting, font wheel zoom, IME handling and Mermaid preview are retained.
- Installation runs typecheck, tests and build. Interactive Electron/IME verification is still required.
