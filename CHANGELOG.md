# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file
starts now (2026-09-11) — earlier history isn't backfilled entry-by-entry; see `git log`
and `STATUS.md`'s "Recent history highlights" for what shipped before this file existed.

## [1.15.0] - 2026-09-12

### Added

- **Import from Hours Tracker (both clients)** — Settings → Import Data reads a CSV
  export from the Hours Tracker app and creates jobs, shifts, and breaks from it. A job
  name that exactly matches one you already have gets its shifts added to it; any other
  name creates a new job (color auto-assigned, starting rate set from whichever hourly
  rate appears most often across that job's rows, backdated to its earliest imported
  shift so pay resolves correctly). Comment/Tags/Adjustments/Mileage all fold into the
  shift's notes field. A shift already present (same job, same clock-in timestamp) is
  skipped, so re-importing the same or an overlapping file is safe. Shows a preview
  (shift/job counts, which jobs are new) before writing anything, and a summary
  afterward. See `docs/import-format.md` for the full column reference, also linked
  in-app (Import screen and Help).
  - Web batches every new record into one `pushChanges` call instead of going through
    the one-row-at-a-time store actions, which would otherwise trigger a network
    round-trip *and* a full re-pull per row for a few-hundred-row file.
  - Mobile reuses the normal `clockIn`/`clockOut`/`startBreak`/`endBreak` SQLite
    functions in a sequential loop — local writes are fast enough that hundreds complete
    in under a second, and every row gets the same outbox bookkeeping a live clock-in
    already gets for free.
  - Verified for real against a genuine Hours Tracker export (286 rows, 5 distinct
    jobs, multi-break rows, one midnight-spanning shift): all 286 rows parsed with zero
    errors, all 5 jobs created correctly, and the resulting History total was checked
    against the file's own reported total (a few percent apart, as expected — Hours
    Tracker's own `Duration`/`Earnings` columns are themselves rounded per shift, while
    Clocker computes pay from the exact clock-in/out/break timestamps instead of
    trusting that rounded figure).

## [1.14.1] - 2026-09-12

### Changed

- The generated remote backup user setup script (Settings → Backups) now mirrors
  Haydrop's own documented setup block almost line-for-line, per explicit instruction:
  `adduser --system --group --shell /bin/bash --home ...` instead of `useradd`,
  `install -d -o -g -m 700 ...` instead of separate `mkdir`/`chown` calls, `touch` +
  `chown` + `chmod 600` for `authorized_keys`, and an explicit `apt install -y borgbackup
  openssh-server` up front. Home directory moved to `/srv/clocker-backup` (from
  `/home/clocker-backup`), matching Haydrop's own single-tree layout; the repository path
  itself was already `/srv/clocker-backup/repositories/clocker` and is unchanged. Shell
  changed from `/bin/sh` to `/bin/bash` to match Haydrop's exact choice (both were already
  "a real shell, not `nologin`" per `1.12.0` — this is a style match, not a second fix).

## [1.14.0] - 2026-09-12

### Added

- **Backups: disaster recovery, ported from Haydrop.** Settings → Backups has a
  collapsed-by-default "Disaster recovery: restore from another location" section — lists
  and restores from any repository URL and passphrase typed in on the spot, entirely
  independent of the saved backup settings. For recovering onto a fresh install, or one
  whose own saved backup settings were themselves lost. New host-agent routes (`POST
  /backup/disaster-recovery/archives`, `POST /backup/disaster-recovery/restore`), reusing
  the existing archive-restore UI/confirmation flow on both clients.
- **History: filtering, both clients.** A collapsible "Filters" panel (matching Export's
  existing job/date-range picker) — date range presets (This Week/Last Week/This
  Month/Last 90 Days/Custom Range) plus a job multi-select checklist, defaulting to the
  same "last 90 days, every job" view History always showed before. The total-earned
  figure and section grouping now reflect whatever's actually filtered in.

## [1.13.0] - 2026-09-12

### Changed

- **Removed the "Repo URL" format validation added in `1.12.0`, per explicit
  instruction** — the user's Haydrop app (same Borg server, same kind of feature) never
  validates this field either; it just passes whatever's typed straight to `borg`, and
  that's the behavior wanted here too. Settings → Backups no longer rejects a URL that
  looks like an attempted remote target but is missing `:path` — it accepts anything
  (trimmed of surrounding whitespace) and lets Borg itself be the judge, same as before
  `1.12.0`. This doesn't change what Borg itself accepts: a bare `user@host` with no
  colon is still silently treated as a local path by Borg's own CLI (see `1.12.0`'s
  entry below for the exact confusing failure that causes) — this app just no longer
  tries to catch that upfront.

## [1.12.0] - 2026-09-12

### Fixed

- **The generated remote backup user setup script used `nologin` as the account's
  shell, which broke the backup entirely** — reported by the user on a real first
  attempt: `borg init` failed with "Got unexpected RPC data format from server: This
  account is currently not available." (the exact banner a `nologin` shell prints).
  Root cause: sshd runs an `authorized_keys` `command="..."` forced command *through the
  account's login shell* (`<shell> -c "<command>"`) — with `nologin` (or `/bin/false`) as
  that shell, the forced `borg serve` command is discarded and the shell's own "not
  available" banner is sent back to the SSH client instead. Changed the generated script
  (`shared/src/backupRemoteSetup.ts`) to use a real `/bin/sh` shell instead — the
  `restrict`+`command=` entry in `authorized_keys` already fully locks the account down
  regardless of shell, so this doesn't reopen anything. **If you already ran the old
  script's commands on a real Borg server, fix the existing account** with:
  `sudo usermod -s /bin/sh clocker-backup` (substitute your actual username if you didn't
  use the default) — editing this app's own code doesn't retroactively change an account
  already created on a different, unrelated remote server.
- **A "Repo URL" missing its `:path` (e.g. `user@host` on its own, instead of
  `user@host:path`) used to fail with a wildly confusing error deep inside Borg** —
  reported by the user on the same real attempt, after fixing the issue above: `borg
  create failed: Repository /tmp/clocker-backup-XXXXXX/user@host does not exist.` Root
  cause: Borg's repo-URL syntax only treats a string as remote when it's `ssh://...` or
  matches `user@host:path` exactly — anything else, including `user@host` with no colon,
  is silently treated as a plain LOCAL path instead, resolved relative to whatever
  directory `borg` happens to be invoked from (here, a per-run temp staging directory,
  hence the odd `/tmp/...` prefix in the error). Now validated up front instead: Settings
  → Backups rejects a "Repo URL" that looks like an attempted remote target but is
  missing the required `:path` with a clear, specific message, both when you save it and
  (defensively, for a config saved before this check existed) when a backup/restore
  actually runs.

## [1.11.0] - 2026-09-12

`server`'s version is unified with `app`/`web`/`shared` from this release on — see
`STATUS.md`'s versioning policy. There is no more independent `server` version track.

### Fixed

- The "Update Server" button and `npm run update` no longer refuse to run just because
  `package-lock.json` is locally modified — it's fully regenerated by the `npm install`
  step either flow already runs, and drifts machine-to-machine (different npm version,
  different OS's platform-specific optional dependencies) even when nothing meaningful
  changed. A locally modified `package-lock.json` is now discarded automatically before
  the "does this host have uncommitted changes?" check, regardless of what else might be
  dirty — with one exception: if `package.json` is *also* modified, both are left alone,
  since that pairing usually means an intentional, uncommitted dependency change in
  progress rather than incidental drift. New shared helper,
  `discardSafeLockfileDrift` in `scripts/lib.mjs`, used by both `scripts/update.mjs` and
  `scripts/host-agent.mjs`'s `/update` handler so the two can't diverge on this rule.
  Motivated by a real incident: an emergency `npm install` run directly on the production
  host (to fix a crash-looping host agent missing a dependency) could otherwise have
  permanently blocked the Update Server button on a lockfile diff that was always safe to
  regenerate away.

## [1.10.0] - 2026-09-12

### Added

- Web: the current tab (and Settings/Help overlay) now persists across a browser reload
  instead of always bouncing back to Clock — saved to `localStorage`, same pattern the
  theme setting already uses.
- Backups, both clients: a new "Set up a dedicated backup user on the remote server"
  section under the generated SSH key, with copy-pasteable shell commands (web: one-click
  Copy; mobile: tap-and-hold to copy) that create a restricted system account
  (`nologin` shell) on the remote Borg server, its repository directory, and an
  `authorized_keys` entry locked to `borg serve --restrict-to-repository ...` — so the key
  is useless for anything beyond running backups, even if it ever leaked. Picks up the
  host/path already typed into "Repo URL" when it looks like `user@host:path`, otherwise
  falls back to the convention documented in `docs/deployment.md`. Generated by a new
  shared helper (`shared/src/backupRemoteSetup.ts`) so both clients and the docs stay in
  sync instead of carrying separate copies that can drift.

### Changed

- Softened the brand blue and red slightly (`#2563eb`→`#1d4ed8`, `#dc2626`→`#b91c1c`) —
  less neon, not navy/maroon — across the header, primary buttons, and both clients'
  default job-color palette (the actual biggest source of "bright blue," since it's the
  default swatch for every new job and shows up as badges/dots throughout the app).

## [1.9.0] - 2026-09-12

### Added

- Dark/light/system theme mode, both clients — a new "Appearance" section in Settings
  (System/Light/Dark). System follows the OS preference live; an explicit choice persists
  (`localStorage` on web, `AsyncStorage` on mobile). Built on a shared token system (CSS
  custom properties on web, a `useTheme()`/`ThemeColors` context on mobile) so every
  screen, not just a few, follows the chosen theme.
- Header now shows the app's own name/brand ("Clocker") in a constant brand color on both
  clients, instead of the current screen's title — which tab you're on is shown by the
  active icon in the bottom bar/tab bar instead. The brand color is deliberately NOT
  themed (stays the same in dark mode).
- Total money earned is now shown on the History screen (sum of pay-eligible shifts in the
  visible range) and live on the Clock screen while clocked in ("$X.XX so far", updating
  alongside the timer) — Timesheets already showed pay totals on both clients, so no
  change was needed there.
- Weekly hours remaining (per job's weekly hours target) now also shows on the Clock
  screen before clocking in, for whichever job is currently selected — previously this
  only appeared once a shift was already open.
- History: swipe-to-delete on both mobile (native swipe via
  `react-native-gesture-handler`'s `Swipeable`) and web (custom Pointer Events drag,
  mouse/touch/pen) — coexists with the existing long-press multi-select. The delete
  button/action is now a trashcan icon instead of text.

### Changed

- Clock screen button labels: "Clock In" → "Clock In Now"; the clock-in row's "At..." →
  "Start At..." (the clock-out/break "At..." buttons are unchanged).

### Fixed

- Backups: the archives section no longer shows an error message at all when there are no
  archives yet — it now behaves like "Recent Runs" and just shows nothing, instead of
  "Cannot read properties of undefined (reading 'archives')".
- Backups: fixed a deeper bug behind the backup key getting stuck on "Generating…"
  forever with no way to retry. The SSH-key retry-polling logic required `/backup/config`
  itself to have already returned a valid, non-empty response before it would even start
  retrying — so if that endpoint ever returned a malformed/empty body (the same failure
  mode already seen on `/backup/archives`), retries never began at all and there was no
  recourse. The retry trigger no longer depends on `config` being non-null first.

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
