# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file
starts now (2026-09-11) — earlier history isn't backfilled entry-by-entry; see `git log`
and `STATUS.md`'s "Recent history highlights" for what shipped before this file existed.

## [1.8.0] - 2026-09-12

App, web, and shared versions are unified from this release on — see `STATUS.md`'s
versioning policy. `server` keeps its own independent version.

### Added

- The app's version is now shown in Settings on both clients (mobile already showed it;
  web is new).
- Export's job filter (both clients) is now a real multi-select — pick any combination of
  jobs, not just one job or all of them — with "Select All"/"Deselect All". Defaults to
  every job selected.

### Fixed

- Mobile: the job chips on the Timesheets tab could render badly oversized (a known
  Android-specific React Native quirk — a horizontal `ScrollView`'s content container
  defaults to stretching its children to the scroll view's full available height instead
  of just matching their own content). Every other chip row in the app happens to use a
  wrapping layout instead, which sidesteps this; Timesheets' job picker was the only
  single-line horizontally-scrolling one. Fixed by opting the row out of stretch
  alignment explicitly. Not verified on a physical device/emulator (none available this
  session) — the fix targets a well-documented, specific failure mode, but flag this if
  it still looks off on a real phone.

- Web: History's multi-select was unreachable entirely, not just unreliable on mobile
  browsers — there was no way to enter selection mode at all. Long-press (mouse, touch,
  or pen) now enters it, matching the mobile app's long-press gesture.
- `ShiftEditor` (both clients): "Done" was styled as plain text; it's now a real button.
  Added a "Cancel" that discards the shift's note draft without saving it (clock-in/out
  and break edits commit immediately when made, the same as everywhere else in the app,
  so Cancel doesn't affect those). Mobile's note field no longer auto-saves on blur, so
  it stays a draft until Done — Cancel would have been meaningless otherwise.
- Backups (both clients): if the backup key still isn't generated after several automatic
  retries, a manual Retry now always appears — previously this only showed up when the
  host agent reported a specific error, so an older deployed host agent (silently missing
  that error field) could leave this stuck on "Generating..." forever with no way out.
- Both clients' API request handling no longer throws an unrelated JSON-parsing error
  when a failed request's response isn't JSON (e.g. a reverse proxy's own error page) —
  the real HTTP status is now always surfaced cleanly, with a specific hint when a 405
  hits `/update*`/`/backup*` (see `docs/deployment.md#the-host-agent`).

## [web 1.7.0] - 2026-09-12 (web only, no mobile changes)

### Changed

- Settings and Help moved out of the bottom tab bar into a hamburger menu at the top
  right of the header, leaving the bottom bar for the 5 tabs actually switched between
  often (Clock, Jobs, History, Timesheets, Export). Closes on an outside click, on
  selecting an item, or implicitly when a bottom tab is tapped.
- Secondary/utility buttons (Refresh, Update Server, Backups, Save Settings, Back Up Now,
  Add a tier/manager/break, etc.) no longer stretch full width — they size to their
  content, like a normal button, instead of spanning the whole screen width on a wide
  desktop viewport. Primary call-to-action buttons (Add Job, Export, Submit Timesheet)
  are unchanged and stay full width.

### Fixed

- The bottom tab bar's labels could crowd or overflow on a narrow screen — tab items can
  now shrink and truncate with an ellipsis instead of overflowing the bar, verified at
  320/375/414/768/1280px widths.

## [1.6.0] - 2026-09-12

### Added

- An in-app Help screen (Settings → Help, both clients) covering how to use every part of
  the app — clocking in/out, jobs/rates/overtime, History, Timesheets, Export, sync, and
  backups — written for the person using the app, not a developer.
- A step-by-step setup guide at the top of Settings → Backups (both clients): what to do,
  in order, to get backups actually working.
- Web: the tab switcher moved from a row of plain text links under the header to a fixed
  bottom icon bar using the same icon set as the mobile app's bottom tabs (Ionicons via
  `react-icons`), styled to mimic the native app as closely as a web page reasonably can.
  The header now shows the current tab's title instead of a static "Clocker".
- Web: Settings now shows a "Last synced" timestamp above the Refresh button, matching
  what the mobile app already showed above its own Sync Now button.

### Fixed

- The backup destination SSH key could get permanently stuck showing "Generating..." if
  key generation ever failed on the host (most commonly: OpenSSH's client tools aren't
  installed) — the failure was silently swallowed with no error and no way to retry short
  of restarting the host agent process. Settings → Backups now shows the real error and a
  Retry button, and every fetch of the backup config retries generation server-side, so a
  fixed host recovers on the next request with no restart needed.
- Removed a leftover "prompt for notes on clock out has moved" message from Settings on
  both clients — that setting has lived per-job since `1.2.0`; the message was never
  cleaned up after the migration.

## [server 0.5.0] - 2026-09-11 (server only, no client changes)

### Security

- CORS is now restricted to an allowlist (`CORS_ORIGIN`, set automatically to
  `https://$DOMAIN` by both production Compose files) instead of reflecting any request's
  `Origin`. Only affects a browser on some other origin than the API's own — the mobile
  app and the deployed web client (same-domain, path-routed) were already unaffected
  either way. Falls back to allowing `localhost`/`127.0.0.1` origins when `CORS_ORIGIN` is
  unset, so `web`'s Vite dev server keeps working locally.

## [1.5.0] - 2026-09-11

### Added

- Android: a persistent notification while clocked into any job (job name, start time,
  elapsed hours), backed by a real foreground service (`react-native-notify-kit`).
  Requires a custom dev/production build — does not work in Expo Go. **Never run on a
  real device from this session** (no Android device/emulator access) — written directly
  against the library's shipped type definitions, not verified end-to-end.

## [1.4.0] - 2026-09-11

### Added

- Optional per-job weekly hours target (each job's settings modal): shows remaining hours
  for the current week, and — while clocked in — an expected clock-out time, on the Clock
  screen. Uses the job's own rounding rules and a simple independent week, not tied to its
  timesheet period.

## [1.3.0] - 2026-09-11

### Added

- Export screen: a "Custom Range" option alongside the fixed presets (this week/last
  week/this month/last 90 days), with start/end date pickers.

## [1.2.0] - 2026-09-11

### Added

- "Prompt for notes on clock out" is now a per-job setting (each job's settings modal)
  instead of one device-local preference covering every job.

### Fixed

- Timesheets/Export/History showed unrounded hours for a still-open (not yet clocked out)
  shift even when the job had rounding enabled — the live Clock screen stopwatch is
  unaffected (it deliberately never rounds).
- Android: the login screen's password field text could become invisible against the OS's
  autofill highlight.

## [1.1.0] - 2026-09-11

### Added

- Self-hosted CAPTCHA (no third-party service) and rate limiting on `/auth/login` and
  `/auth/register`, plus a "remember me" checkbox (checked by default) that controls
  whether the issued token expires.
- An in-app "Update Server" button (Settings, both clients) that pulls the latest
  committed code and redeploys, backed by a new host-side process
  (`scripts/host-agent.mjs`) that runs outside Docker.
- Full BorgBackup support (Settings → Backups, both clients): repo/passphrase/retention
  configuration, a plain-language backup schedule, an archive browser, and a restore flow
  requiring the archive name to be typed to confirm.
- Full shift editing on both clients: correct a shift's clock-in/out date and time,
  add/edit/delete its breaks, and edit its note from History.

## [1.0.0] - earlier

Initial scaffold through full web/mobile feature parity, Caddy + Docker Compose
deployment, rate tiers/overtime/rounding, CSV/email export, and Manager/Timesheets
features. See `git log` for the detailed history.
