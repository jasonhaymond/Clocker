# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file
starts now (2026-09-11) — earlier history isn't backfilled entry-by-entry; see `git log`
and `STATUS.md`'s "Recent history highlights" for what shipped before this file existed.

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
