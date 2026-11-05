# StudyDash

A Windows student dashboard for assignments, announcements, grades, routines and focused study. The production build displays **#1 Dashboard** and starts with no preset routines or connected accounts.

## Windows app

Extract the complete Windows package and run **StudyDash.exe**. Its first launch installs the app for the current Windows user, creates **StudyDash Dashboard** in the Start menu, registers it in Windows Installed apps, and opens the installed copy. Administrator access is not required. Subsequent launches reuse that installation. `Install.cmd` remains available for manual installation.

The Windows build is unsigned.

Uninstall through **Settings > Apps > Installed apps > StudyDash Dashboard**. After confirmation, uninstall removes the installed program, shortcut, saved tasks/settings/accounts, and embedded browser profile. A separate personal StudyDash edition is not removed.

## Features

- Google Classroom, Gmail, Canvas, Outlook and grade-portal integrations. Users configure their own accounts and API credentials where required.
- Tasks and routines with accent-based colors and optional individual overrides.
- Settings > Profile > Your name updates the greeting and IQ friend code. Existing IQ friend codes remain compatible.
- Black background, white foreground/accent and system font by default, with saved appearance settings.
- Study timer, ambient animation, configurable breaks, full-screen mode and dockable tools: Desmos, Wiktionary, local music and an embedded browser with tabs.
- Persistent browser sessions/history and an optional Spotify connection.

Personal AP Lang training, AP Bio/SAT/piano routines and course-specific grade presets are excluded from this production edition.

## Build

Use Node.js 24 or newer. The Windows packaging command requires Windows x64.

```powershell
npm ci
npm --prefix frontend ci
npm run typecheck
npm test
npm run build
npm run package:windows
```

The package is written to `dist/StudyDash-Production-Windows-x64`. Keep the whole package together when distributing it. The packager includes the Electron runtime, installation/uninstallation scripts, icons and third-party notices.

The React source is in `frontend/src`. Built UI assets are also committed so the local server can run without rebuilding the interface. Component/reference license notices are in `frontend/licenses` and `THIRD-PARTY-NOTICES.txt`.

Local MP3 files can be placed in `music/` before packaging. Runtime binaries, personal music, account credentials, databases, browser profiles and dependency folders are not committed to this repository.

## Local server

For browser-based development, use a separate data folder and port:

```powershell
$env:STUDYDASH_DATA = Join-Path $env:TEMP 'StudyDash-Development'
$env:STUDYDASH_PORT = '47379'
$env:STUDYDASH_TEST = '1'
npm start
```

Open `http://127.0.0.1:47379`. Native embedded-browser features require the packaged desktop app. Test mode disables tray notifications and Windows startup registration.

## Saved data

The installed production app uses:

- `%LOCALAPPDATA%\Programs\StudyDash Production` for application files.
- `%APPDATA%\StudyDash Production` for tasks, settings, connections and backups.
- `%APPDATA%\StudyDash Production Desktop\window\47322` for appearance and embedded-browser sessions.

Updating the app retains its saved data. Uninstalling removes those production folders.
