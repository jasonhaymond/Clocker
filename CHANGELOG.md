# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file
starts now (2026-09-11) — earlier history isn't backfilled entry-by-entry; see `git log`
and `STATUS.md`'s "Recent history highlights" for what shipped before this file existed.

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
