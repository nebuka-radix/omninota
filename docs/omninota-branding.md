# omninota branding (056)

Lowercase omninota is used for the application display name, package name, renderer title,
sidebar/title bar identity, electron-builder productName and executableName (including mac).
BrowserWindow and app-info already read APP_IDENTITY.displayName; Main also sets app.setName
before userData setup. No executable is launched by this installation script.

macOS package output: omninota.app; executable inside Contents/MacOS/omninota.
The output parent comes from build.directories.output and the current package:dir script.
Development still launches the installed Electron binary; this change does not rename that binary.

For data continuity, APP_IDENTITY.userDataDirName stays GTD and devUserDataDirName stays GTD-dev.
DATABASE_FILE_NAME remains gtd.sqlite, appId remains its existing com.radix-studio.gtd value.
Existing tasks, notes and layout preferences are not copied, moved or migrated by this rename.
GTD_* environment-variable names remain for compatibility. No database file is opened by
this script except temporary databases used by the existing test suite.

package-lock.json root names are synchronized without reinstalling dependencies. Existing
identity tests are updated only for branding fields; assertions about the legacy data paths
are kept. A new test covers branding and data continuity.

The script runs typecheck/tests/build/package:dir and checks the generated macOS Info.plist
and executable name/permissions. Packaging may download cached-missing build tools. The script
does not push to GitHub, launch the .app, or sign/notarize beyond existing build configuration.
Only a build output directory already ignored by Git is accepted, to avoid committing bundles.
