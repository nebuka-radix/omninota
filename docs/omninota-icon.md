# omninota icon (057)

Download the previously generated logo as resources/omninota-icon.png before running 057.
The PNG must be square and at least 512px. The original is kept unchanged.
macOS sips creates standard 16/32/128/256/512px iconset entries with Retina variants,
including 1024px. iconutil builds resources/omninota.icns in a temporary directory.
electron-builder uses build.mac.icon = resources/omninota.icns.

No dependency is installed. No database, application ID, data location, environment-variable
name or source image is changed. Input PNG may be the only uncommitted project file when
running this installer; unrelated changes must be committed or stashed first.

The installer runs typecheck/tests/build/package:dir -- --publish never, checks the built
Info.plist CFBundleIconFile, and verifies the packaged ICNS bytes match the generated icon.
It does not launch the app or publish/push anything. Package output must already be ignored
by Git. The installer commits source PNG, ICNS, configuration, tests and this document only
after the verification sequence passes (git add . also includes gemini-scripts).

This configures the packaged macOS app icon. Unpackaged development still runs the Electron
bundle; its Dock icon is not customized by this change. Launch the newly packaged omninota.app
for visual confirmation. No system-wide icon cache reset command is run.
