# Clocker — Status

Read this first if you're a new Claude session with no memory of this project. It's a
snapshot of where things stand, not a spec — the docs it points to are the source of
truth for anything that might have changed since.

**Written:** 2026-09-11, after auditing the actual repo (git log, git status, docs/,
package.json files, app/eas.json, app/app.json) against a detailed prior-session memory
dump. Everything below was verified against the repo at that date; treat it as possibly
stale by the time you read it — re-check anything load-bearing (`git log`, `git status`,
the relevant doc) before acting on it.

**Amended:** same day, later session — a real production incident (§4/§5) was diagnosed
and fixed, the web client got a global error banner, `CLAUDE.md` now requires this file to
be kept current at the end of every work session (this amendment is that policy's first
real use), and full shift/break time editing shipped on both clients (§3).

**Amended again:** same day, later session — self-hosted CAPTCHA + rate limiting +
"remember me" shipped on both clients (§3), closing two of the three items in
`docs/deployment.md#security-gaps-to-close-before-this-is-public` (§4).

**Amended again:** same day, later session — an in-app "Update Server" button shipped on
both clients, backed by a new host-side process (`scripts/host-agent.mjs`, §3/§5).
Not yet run against a real production host from this session (no SSH access) — the auth
and dirty-tree-refusal guards were verified locally, but the actual `git pull`/`docker
compose` sequence it triggers has not been exercised end-to-end.

**Amended again:** same day, later session — full BorgBackup support (config, manual
trigger, scheduling, archive browser, typed-confirmation restore) shipped on both clients,
built into the same `scripts/host-agent.mjs` process rather than a new one (§3/§5). Caught
and fixed a real bug during this session's own verification: a config-validation guard
that threw outside its try/catch crashed the entire host agent process (both backup AND
update capability) on the very first un-configured trigger — see §3 for detail. `borg`
itself was never exercised (not installed on the dev machine this was built on); only the
surrounding HTTP/config/guard layer was verified for real.

**Amended again:** same day, later session — started real version tracking
(`CHANGELOG.md`, versions bumped to `1.1.0`/`0.2.0`) per explicit instruction to make this
default practice on every project (§1). Fixed a real rounding bug found via a user
screenshot: `roundedWorkedMillis` skipped rounding entirely for a still-open shift, so a
job's "Timesheets"/"Export" hours weren't rounded until you actually clocked out, even
though the pay-calculation pipeline itself was correct (§3). Moved "prompt for notes on
clock out" from a single device-local preference to a per-job synced setting (§3). Fixed
an Android-only bug: the login password field's text could become invisible against the
OS's autofill highlight, since the input style never set an explicit text color (§3).

**Amended again:** same day, later session — added a "Custom Range" option to Export on
both clients (start/end date pickers alongside the fixed presets), `1.3.0` (§3).

**Amended again:** same day, later session — added an optional per-job weekly hours
target: "remaining hours"/"expected clock-out" shown on the Clock screen, both clients,
`1.4.0` (§3).

**Amended again:** same day, later session — added a persistent Android notification
while clocked in (job/start time/elapsed hours), `1.5.0` (§3/§4). Mobile-only; needs a
custom dev/production build (not Expo Go); **never run on a real device this session**.

**Amended again (2026-09-11, later session):** closed one of the two remaining items in
`docs/deployment.md#security-gaps-to-close-before-this-is-public` — CORS is no longer
`{ origin: true }`, `server` bumped to `0.5.0` (§3/§4). No client-side changes.

**Amended again (2026-09-12, later session):** added an in-app Help screen and a backup
setup walkthrough (both clients), fixed a real bug where a failed backup SSH key
generation got stuck showing "Generating..." forever with no error or retry, reworked the
web client's tab switcher into a bottom icon bar mimicking the mobile app's, added a "Last
synced" display to web Settings, and removed a stale leftover Settings message on both
clients — `1.6.0`/`server` untouched this round (§3).

**Amended again (2026-09-12, same day, later session):** web-only follow-up — moved
Settings/Help out of the bottom tab bar into a header hamburger menu, made the bottom bar
robust at narrow widths (labels shrink/ellipsize instead of overflowing), and stopped
secondary/utility buttons from stretching full width on wide screens — `web` bumped to
`1.7.0` (§3).

**Amended again (2026-09-12, same day, later session):** fixed History multi-select on
web (it was completely unreachable, not just flaky on mobile browsers — see §3), gave
`ShiftEditor` a real Done button plus a Cancel that discards the note draft on both
clients, unified `app`/`web`/`shared` onto one "project version" (`1.8.0`, now shown in
Settings on both clients — see §1's revised versioning policy), and hardened both
clients' `api.ts` against a non-JSON error response. Also diagnosed (but couldn't fix
directly — no SSH access) a real production 405 on "Update Server": the user's
`nextcloud` host almost certainly has a stale external-proxy Caddy config missing the
`/update*`/`/backup*` routes; see §4 for the exact fix to hand the user.

**Amended again (2026-09-12, same day, later session):** turned Export's job filter into
a real multi-select on both clients (Select All/Deselect All, any combination — was
single-select), and fixed a real mobile-only bug the user screenshotted: Timesheets' job
chips could render badly oversized on Android, traced to a known React Native horizontal-
`ScrollView`-stretch quirk that every other chip row in the app happens to avoid by using
a wrapping layout instead — see §3 for detail. The mobile fix is unverified on a real
device (none available this session).

**Amended again (2026-09-12, same day, later session):** turned Export's job filter into
a scrolling checklist (checkboxes + color dots) instead of a wrapping grid of chip
buttons, both clients. Then fixed two more user-reported bugs: Backups' archives section
crashed with "Cannot read properties of undefined (reading 'archives')" when the response
was empty (now shows nothing, like Recent Runs, instead of an error); and a deeper bug in
the SSH-key retry-polling logic — it required `/backup/config` to have already resolved
successfully before it would even start retrying, so if that endpoint itself ever
returned a malformed/empty body, the UI stayed on "Generating..." forever with no
recourse. Confirmed with the user this was still happening on the live deployed site (not
just stale deployment) before fixing.

**Amended again (2026-09-12, same day, later session):** shipped a full dark/light/system
theme system on both clients, a constant-branded header ("Clocker" + brand color,
replacing the per-screen title), swipe-to-delete on History (both clients) with a
trashcan icon replacing the text delete button, total money earned shown on History and
live on Clock while clocked in, weekly-hours-remaining shown on Clock even before
clocking in, and two Clock button relabels ("Clock In Now"/"Start At...") — `1.9.0` (§3).
Re-diagnosed (still no SSH access) that "Update Server" not working is the same external-
proxy Caddy config gap identified in the prior amendment, not a new/different bug.

**Amended again (2026-09-12, same day, later session):** given explicit one-time
permission, SSHed into the real `nextcloud`/`webproxy` hosts to chase a live 502 on
Update Server and the backup key stuck generating again — found and fixed the actual
root cause on `nextcloud` (§4/§5), then fixed two more user-reported issues purely in the
repo: a web reload always bouncing back to the Clock tab, and the brand blue/red reading
as too bright. **Standing rule going forward, per explicit instruction**: never SSH into
or otherwise act on a remote host without asking first, in that specific session, even
though working keys/config for `nextcloud`/`webproxy` already exist on this machine —
permission doesn't carry over between sessions (see `~/.claude` memory
`remote_host_access_permission.md`).

**Amended again (2026-09-12, same day, later session):** added in-app instructions
(Settings → Backups, both clients) for setting up a dedicated, restricted backup user on
a remote Borg server, softened the brand blue/red slightly, and fixed web's reload-resets-
tab bug — `1.10.0` (§3).

**Amended again (2026-09-12, same day, later session):** fixed the "Update Server"
button/`npm run update` refusing to run over a solely-`package-lock.json`-dirty tree (§3)
— shipped this initially with no version bump at all since it only touched `scripts/`
and docs, corrected once to bump `server` alone on its then-independent `0.x` track, then
corrected again per explicit instruction that backend and client-facing versions must
always be the same: `server`'s independent track is now abolished entirely and it's
unified into the same version as `app`/`web`/`shared` — `1.11.0` (§1 now says so
explicitly, to not repeat either mistake).

**Amended again (2026-09-12, same day, later session):** fixed two real bugs the user hit
on their first real remote-backup attempt (nologin shell breaking the generated backup
user's forced SSH command; a "Repo URL" missing `:path` failing with a confusing local-
path error) — `1.12.0` — then removed the repo-URL validation that second fix added,
per explicit instruction to match how the user's Haydrop app handles the same field (no
validation at all, just pass it straight to `borg`) — `1.13.0`. See §3 for both.

**Amended again (2026-09-12, same day, later session):** ported Haydrop's disaster-
recovery backup restore feature (list/restore against any ad-hoc repo+passphrase,
independent of saved settings) and added date-range + job filtering to the History screen
on both clients, reusing Export's existing filter UI pattern (now hoisted into
`shared/src/dateRanges.ts` so Export and History share one implementation) — `1.14.0`
(§3).

**Amended again (2026-09-12, same day, later session):** updated the generated remote
backup user setup script to mimic Haydrop's own documented setup block almost
line-for-line, per explicit instruction with the exact block to match (`adduser`/
`install -d`/`touch` instead of `useradd`/`mkdir`+`chown`, home moved to
`/srv/clocker-backup`, shell changed from `/bin/sh` to `/bin/bash`) — `1.14.1` (§3).

**Amended again (2026-09-12, same day, later session):** added a CSV import feature
(both clients) for bringing in historical data from the Hours Tracker app — jobs,
shifts, breaks, matched against existing jobs by exact name or creating new ones with an
auto-picked color and a backdated starting rate — `1.15.0` (§3). New shared parsing
module (`shared/src/importFormat.ts`), a documented header/column reference
(`docs/import-format.md`), and a Settings → Import Data screen on both clients. Verified
for real against the user's own genuine Hours Tracker export.

**Amended again (2026-09-12, same day, later session):** per a user-supplied screenshot
showing Settings as a 6th bottom tab with its lower content clipped behind the tab bar,
moved mobile's Settings/Help behind a header hamburger menu to match web's own layout
exactly (5 bottom tabs, same as web) — turned out the REAL bug was that Settings had no
`ScrollView` at all, not just insufficient padding, making its lower buttons genuinely
unreachable on-device. Also fixed, per a second screenshot: the Jobs screen (both
clients) was interleaving archived jobs alphabetically with active ones instead of
sorting them to the bottom — `1.16.0` (§3).

**Amended again (2026-09-12, same day, later session):** archived jobs are now hidden
everywhere except the Jobs screen (both clients) — they'd still been showing up as
pickable options in Export/History's job checklists and Timesheets' job selector (Clock
already excluded them). The Jobs screen itself now hides archived jobs by default too,
with a "Show Archived Jobs (N)" toggle to reveal them — `1.17.0` (§3).

A personal timeclock/hours-tracking app (multiple jobs, clock in/out, breaks, history,
pay calculation, CSV/email export). Two clients, one API:

- **`app/`** — Expo/React Native (TypeScript) mobile app. Offline-first: local SQLite
  (`app/src/db`) is the source of truth for the UI; every write also lands in a
  `pending_changes` outbox that syncs to the server.
- **`web/`** — Vite + React (TypeScript) thin client. No local database, no offline
  story — calls the server directly on every action. Deliberately built differently from
  the mobile app; see `docs/architecture.md#two-frontend-clients-one-api` for the reasoning.
- **`shared/`** (`@clocker/shared`) — framework-free TypeScript: types, pay/rounding/
  period/export calculations, used by both clients so they agree on every number.
- **`server/`** — Fastify + Prisma + PostgreSQL. Email/password auth, `/sync/push` and
  `/sync/pull` (both clients call these; mobile opportunistically, web on every mutation).

npm workspaces monorepo (`shared`, `app`, `server`, `web`). **`CHANGELOG.md` started
2026-09-11** (Keep a Changelog format) after the user asked to make version-tracking
default practice — earlier history isn't backfilled, only `git log`/§7 cover that.

**Versioning policy, revised 2026-09-12, then revised again same day**: originally
unified only `app/package.json`, `app/app.json`, `web/package.json`, and
`shared/package.json` into one "project version" (previously each package bumped
independently and had drifted out of sync, e.g. app at `1.6.0`/web at `1.7.0`/shared at
`1.4.0`), while `server/package.json` stayed on its own independent `0.x` track as a
"backend service versioned separately." **Per explicit instruction later the same day,
that split is gone**: `server/package.json` is now unified into the exact same "project
version" as `app`/`web`/`shared` — backend and client-facing versions must always match,
full stop. All five (four packages, one version) are at `1.17.0` as of this session; the
number is shown in Settings on both clients (mobile: `Application.nativeApplicationVersion`/
`app.json`, already existed; web: `__APP_VERSION__`, baked in from `web/package.json` via
a `define` in `vite.config.ts`). A version bump + CHANGELOG entry lands with every
shipping commit, and **this applies to `scripts/`/deploy-tooling/docs-only changes too,
not just source changes in one of the four packages** — there's no separate "scripts"
version, so a repo-wide change that isn't client-facing still bumps all four
`package.json`s together and gets its own changelog entry (e.g. the `1.11.0` "Update
Server" lockfile-handling fix below, which only touched `scripts/` and docs) —
corrected twice in a row: first shipped with no version bump at all, then re-shipped with
only `server` bumped on its own separate track before that track was abolished entirely.

**Project policy (see `CLAUDE.md` at repo root, authoritative — not duplicated here):**
every client must expose the same feature set; architecture can differ per platform
(web stays thin/no local DB) but user-facing capability must not. New features are built
into both clients as one unit of work.

## 2. Architecture — pointers

- **`docs/architecture.md`** — full design rationale: the two-client split, local-first
  principle, why client-generated UUIDs, why an outbox instead of a dirty flag, why
  last-write-wins instead of a CRDT, why rate is versioned history not a flat number, why
  a custom Fastify server instead of a BaaS, request flow, OTA updates.
- **`docs/sync-protocol.md`** — exact push/pull mechanics: outbox draining, conflict
  resolution (last-write-wins by `updatedAt`), ownership checks, what the protocol
  deliberately doesn't do.
- **`docs/data-model.md`** — every table/field, Postgres and SQLite sides, including the
  rate-tier/`RateVersion` history model.
- **`docs/api-reference.md`** — every HTTP endpoint with a curl smoke test.

## 3. Current status — what's built

Verified present in the repo (code + docs, not just described in memory):

- Multiple jobs (name/color), clock in/out with live timer, concurrent jobs (a job can't
  double-clock into itself, a different job can run alongside it), "Clock In/Out At..."
  for explicit past times.
- Breaks (start/end, with "at..." explicit-time variants), excluded from worked-hours
  totals.
- Per-shift notes, optionally auto-prompted right after clock-out.
- History grouped by day, multi-select delete.
- CSV export by date range/job (native share sheet on mobile); HTML email draft via
  `expo-mail-composer` on mobile (`app/src/lib/exportFormat.ts`).
- Rate tiers per job with versioned history (`RateVersion` — editing a rate today never
  rewrites past shifts' pay) and optional weekly overtime (`app/src/lib/pay.ts`).
- Optional per-job time rounding (5/10/15/20/30/60/120 min, up/down/nearest) for
  calculation purposes only — stored punch times are never modified
  (`app/src/lib/rounding.ts`).
- Manager entity (name/email), synced. Timesheets tab: per-job recurring pay period
  (weekly/biweekly/monthly, `app/src/lib/timesheetPeriods.ts`), prev/next nav, "Submit
  Timesheet" emailing CSV/plain-text/both to assigned Managers. Period type, submission
  format, and recipients are configured per-job (`JobDetailModal.tsx`), not globally.
- Manual + automatic background sync; email/password auth.
- OTA update plumbing via `expo-updates` with a Settings-screen banner — code is in place
  and `app/eas.json` exists (development/preview/production profiles,
  `EXPO_USE_METRO_WORKSPACE_ROOT=1`, `EXPO_PUBLIC_API_URL` baked to
  `https://clocker.haymondtechnologies.com` for preview/production) — **but `app/app.json`
  has no `extra.eas.projectId` yet**, confirming `eas login` / `eas update:configure` has
  never actually been run. This is the real blocking gap, not just a memory claim (see §4).
- **Web client is at full feature parity with mobile** (commit `db897b0`,
  "Bring web client to full feature parity with the mobile app") — all of the above,
  adapted per the platform-constraint rule in `CLAUDE.md` (e.g. CSV download + clipboard
  copy + `mailto:` instead of a native share sheet/mail composer).
- Deployment automation: `npm run deploy` (Caddy+Docker Compose or external-proxy mode),
  pre-deploy DB snapshot (added most recently, commit `9004c7d`), EAS build submission
  folded into the same command (commit `cb18a21`), web deployed unconditionally on the
  same domain as the API via path-routing (commit `5886a91`).
- Web client has a global error banner (`web/src/App.tsx`, commit `d55fcc8`) — every
  store-action failure sets a visible message above whichever tab is active, instead of
  rejecting silently with nothing shown. This is what turned an opaque "Add Job does
  nothing" into a diagnosable "Request failed" once the incident in §4/§5 below hit.
- Production port-stability fix (`d69b080`) has now been confirmed by a real incident,
  not just a local test: ports genuinely stayed fixed across redeploys on `nextcloud` —
  the 502 incident in §4/§5 was caused by a *stale external-proxy config* left over from
  before that fix landed, not by ports drifting again.
- **Full shift editing, both clients**: tap any shift in History (open or already
  clocked out) to correct its clock-in/out date and time, add/edit/delete breaks, and
  edit its note — no more delete-and-recreate to fix a mistake. Mobile:
  `app/src/components/ShiftEditor.tsx` + two new `database.ts` functions
  (`updateBreakTimes`, `deleteBreak`). Web: `web/src/components/ShiftEditor.tsx` + the
  same two actions added to `store.tsx`. Deliberately one-directional: you can *set* a
  clock-out on a still-open shift (closing it), but not clear an existing one and reopen
  it, since the rest of the app assumes at most one open shift per job. Verified against
  a real running server (every new mutation shape replayed via `/sync/push`/`/sync/pull`,
  including the "set clock-out on a previously-open shift" path) plus clean typecheck and
  builds on both clients — not yet clicked through by hand in either a real browser or a
  mobile device/simulator.
- **Self-hosted CAPTCHA + rate limiting + "remember me", both clients**: `/auth/login` and
  `/auth/register` now require a numeric answer to a `GET /auth/captcha`-issued arithmetic
  question (single-use, 5-minute TTL, in-memory — `server/src/lib/captcha.ts`) and are
  rate-limited to 10 requests/15min per IP (`@fastify/rate-limit`, `server/src/index.ts`).
  Deliberately no third-party CAPTCHA service (no reCAPTCHA/Turnstile account) per explicit
  instruction. Both login screens (`app/src/screens/LoginScreen.tsx`,
  `web/src/App.tsx`'s `AuthForm`) fetch/display the question and a "Remember me" checkbox,
  checked by default. `rememberMe: true` (the default) issues a JWT with no `exp` claim —
  never expires; `false` issues a 1-day token (`server/src/lib/auth.ts`). Mobile stores the
  token in AsyncStorage only when remembered (`app/src/auth/tokenStore.ts`'s `persist`
  param), otherwise keeps it in the module-level cache only (gone on app relaunch); web
  uses `localStorage` vs `sessionStorage` the same way (`web/src/api.ts`). Verified against
  a real running local server: captcha issue/consume/expire, wrong-answer rejection,
  correct-answer register+login, decoded JWTs confirmed with/without `exp` for both
  `rememberMe` values, and rate limiting actually returning 429 after 10 attempts. All
  three workspaces (`server`, `app`, `web`) typecheck clean. Not yet clicked through by
  hand in a real browser or mobile simulator (no browser-automation/emulator access from
  this session).
- **In-app "Update Server" button, both clients**: Settings has a button that triggers
  `git pull --ff-only && npm install && npm run deploy -- --skip-app` on the deploy host,
  polling a status endpoint for progress/result. Backed by a new standalone process,
  `scripts/host-agent.mjs` — deliberately NOT inside the `server` Docker container
  (which has no host/Docker-socket access by design, chosen over the alternative of
  mounting those into the container, per explicit instruction); it runs directly on the
  host, started via pm2 (auto, from `npm run deploy`) or documented systemd instructions,
  and survives the very container restarts it triggers. Reached under the same domain via
  a new `/update*` Caddy route (bundled: `host.docker.internal`; external: added to the
  printed proxy snippet) on a new auto-picked `HOST_AGENT_PORT`/`HOST_AGENT_BIND`. Auth reuses
  the existing `JWT_SECRET`/bearer token — no separate secret. Refuses to run if the host's
  working tree is dirty or an update is already in progress. Verified locally: auth
  (401 without/with-bad token), status shape, and — using this session's own genuinely
  dirty working tree — the "uncommitted changes" refusal actually firing, which is exactly
  the guard that matters most to get right (it's also what stopped this verification pass
  from ever executing a real `git pull`/deploy against this repo). The actual
  pull-and-redeploy sequence has **not** been exercised end-to-end against a real host —
  only the HTTP layer and its guards.
- **Full BorgBackup support, both clients**: Settings → Backups (`app/src/screens/BackupsScreen.tsx`,
  `web/src/screens/BackupsScreen.tsx`) — repo URL/passphrase/retention/schedule config, a
  dedicated generate-once Ed25519 SSH key (for a remote repo, `.backup-ssh/`), manual
  "Back Up Now" + live log, a plain-language schedule picker (Off/Daily/Weekly/Monthly)
  converted to/from cron in one place (`scripts/host-agent.mjs`'s `buildCron`/`parseCron`,
  not duplicated per client), an archive browser (`borg list --json`), and a restore flow
  requiring the archive name to be typed to confirm before enabling the button — mirrors
  Haydrop's own admin backup UI, adapted for Clocker's stricter host/container separation
  (settings live in a host-local JSON file, `.backup-config.json`, not a Postgres table,
  since the containerized server has no host access to act on them anyway). Built into the
  same `scripts/host-agent.mjs` process as the update button (one pm2 process, one port,
  `/backup*` routed alongside `/update*`) rather than a second service.
  - **Real bug caught and fixed during this session's own verification**: the config
    validation guard (`if (!cfg.repoUrl || !cfg.passphrase) throw ...`) in both
    `runBackupNow` and `restoreBackup` originally sat *outside* their own try/catch. Since
    both are invoked via `setImmediate` from the HTTP handler (fire-and-forget, so nothing
    upstream catches a throw that escapes them), triggering a backup before configuring a
    repo threw an uncaught exception that crashed the **entire host agent process** —
    taking down the update button too, not just backups. Caught by actually POSTing
    `/backup/run` against a locally-running instance, not by reading the code. Fixed by
    moving both guards inside their try blocks and adding a synchronous pre-check in the
    HTTP handler (belt and suspenders — the handler now returns a clean `400` before ever
    reaching the async path). Re-verified after the fix: clean 400, process survives.
  - Also exercised for real: the full `runBackupNow` pipeline through the actual
    `docker compose exec postgres pg_dump` step (failed cleanly — a throwaway test
    `.env.prod` had no `DOMAIN`/`POSTGRES_PASSWORD`, unrelated to Borg itself — and the
    failure was correctly caught, logged, and recorded in run history without crashing).
  - **Never exercised**: the actual `borg` binary (`init`/`create`/`list`/`extract`/`prune`)
    — not installed on the Windows dev machine this was built on. First real backup and
    first real restore on production should be watched closely, not trusted blind.
- **Rounding fix: a still-open shift's hours are now rounded too.** User reported (with a
  screenshot) that Timesheets showed unrounded hours (e.g. "4h 17m") for a job with
  rounding enabled. Traced to `shared/src/rounding.ts`'s `roundedWorkedMillis`: it
  explicitly skipped rounding whenever a shift had no `clockOut` yet, falling back to raw
  elapsed time — correct for the live ClockScreen stopwatch (which uses a *different*
  function, `workedMillis`, on purpose) but wrong for History/Timesheets/Export's "hours"
  figures, which the user expected to reflect rounding even mid-shift. Fixed by rounding
  the end (clockOut, or "now" if still open) the same way the start already was. Verified
  directly: an open shift started 4h17m ago now reports exactly 4.25h with 15-min
  "nearest" rounding, vs. the unfixed 4.2833h; disabling rounding still returns the raw
  value. Confirmed via the actual investigation, not a guess — first checked that the
  calculation engine and the server's push/pull round-trip were both already correct
  (they were) before finding the real defect in the open-shift branch.
- **"Prompt for notes on clock out" moved from a device-local preference to a per-job
  synced setting.** `Job.promptForNotesOnClockOut` (new Postgres migration
  `20260911191746_add_job_prompt_for_notes`, new SQLite migration V5,
  `SCHEMA_VERSION` bumped to `5`). Configured from each job's settings modal
  (`JobDetailModal`/`JobEditor`) next to rounding/overtime; `app/src/lib/preferences.ts`
  and `web/src/lib/preferences.ts` (which held only this one preference) are deleted.
  Verified the field round-trips through a real push/pull against a running local server.
- **Android login password field text was invisible.** User-reported with a screenshot:
  Android's autofill highlighted the field a pale yellow, and since
  `LoginScreen.tsx`'s input style never set an explicit `color`, the typed characters
  ended up effectively the same color as that OS-applied tint. Fixed by setting an
  explicit `color`/`backgroundColor` on the shared input style. Not yet re-verified on a
  real Android device from this session (no device/emulator access) — worth confirming
  the actual fix looks right, not just that it compiles.
- **Export: "Custom Range"** (both clients) — a fifth range option alongside the four
  fixed presets, with start/end date pickers (mobile: `useDateTimePicker`; web: native
  `<input type="date">`, using local-timezone "YYYY-MM-DD" strings rather than
  `toISOString()` to avoid a UTC-offset day shift). End date is inclusive (internally
  `addDays(customEnd, 1)` as the exclusive upper bound, matching every other range).
  Verified via a clean typecheck and production build on web; not clicked through by hand
  in a browser or on a device (no such access from this session).
- **Optional per-job weekly hours target** — `Job.expectedWeeklyHours`/
  `expectedHoursWeekStartDay` (Postgres migration `20260911195029_add_job_expected_weekly_hours`,
  SQLite `SCHEMA_VERSION` bumped to `6`). Configured per job (settings modal, next to
  rounding/notes-prompt); shown on the Clock screen's open-shift card as "Xh Ym left this
  week" and, while clocked in, "expected out H:MM". Calculation
  (`shared/src/expectedHours.ts`'s `calculateWeeklyProgress`) reuses the job's own
  `roundedWorkedMillis` for every shift in the current week (including the open one,
  counted to "now") and a newly-exported `mostRecentWeekStart` (previously private to
  `timesheetPeriods.ts`) for the week boundary — deliberately independent of the job's
  timesheet period settings, per explicit design decision. Verified directly: a synthetic
  16h-already-worked-plus-a-2h-open-shift scenario against a 40h target produced exactly
  the expected remaining-minutes and expected-clock-out values, and the field round-trips
  (including clearing to `null`) through a real push/pull against a running local server.
  Not clicked through by hand on a device/browser. Web computes progress directly from
  its full in-memory shift/break list (no local DB to query); mobile fetches each
  target-having job's current-week shifts/breaks from SQLite on load.
- **Persistent Android "clocked in" notification** (`app/src/lib/clockedInNotification.ts`,
  wired into `ClockScreen.tsx`) — a real Android foreground service (not just a "sticky"
  flag) showing job name(s), start time, and elapsed hours, via `react-native-notify-kit`
  (a maintained fork of Notifee, which was archived by its author in April 2026 — chosen
  over the archived original per explicit instruction). Only one foreground service is
  allowed per app, so multiple simultaneous open shifts fold into one notification, one
  line per job, rather than several. Updates on the same 30s tick that drives the in-app
  live timer. Requires a custom Expo dev/production build — **does not work in Expo Go**
  (`app.json`'s plugin config adds the native module; `docs/development.md` flags this).
  Written directly against the library's shipped `.d.ts` files (verified real API surface,
  not guessed), but **never run on a real Android device or emulator from any Claude
  session** — no such access was available. Treat this as unverified until someone
  actually builds and runs it.
- **CORS restricted to an allowlist** (`server/src/index.ts`, `server` bumped to `0.5.0`)
  — no longer `{ origin: true }`. Both production Compose files now set `CORS_ORIGIN` to
  `https://$DOMAIN` automatically; unset (local dev), it falls back to allowing any
  `http://localhost:<port>`/`http://127.0.0.1:<port>` origin so `web`'s Vite dev server
  keeps working. Verified for real (not just by reading the code): ran the server
  standalone with a throwaway port and confirmed by curl that a matching `CORS_ORIGIN`
  gets `access-control-allow-origin` back, a non-matching origin gets nothing, the
  localhost fallback works when `CORS_ORIGIN` is unset, and a matching `CORS_ORIGIN`
  correctly *stops* the localhost fallback from also being allowed. No client-side
  changes — this only ever gated browser requests from some other origin than the API's
  own, and the mobile app/deployed web client (same-domain) were unaffected either way.
  Closes one of the two items in
  `docs/deployment.md#security-gaps-to-close-before-this-is-public`; the refresh-token
  gap remains open (see §4).
- **In-app Help screen, both clients** (`{app,web}/src/screens/HelpScreen.tsx`) — an
  accordion of end-user documentation (clocking in/out, jobs/rates/overtime, History,
  Timesheets, Export, sync, backups) reachable from Settings, next to Backups. Deliberately
  end-user-focused, not a copy of the developer docs in `docs/`.
- **Backup SSH key generation: fixed a real "stuck forever" bug, plus an in-app setup
  walkthrough.** `scripts/host-agent.mjs`'s `ensureBackupSshKey()` ran `ssh-keygen` via
  `spawnSync` but never checked whether it actually succeeded — if it failed (most likely:
  OpenSSH's client tools aren't installed on the host), nothing was ever logged and the key
  silently stayed missing forever, so Settings → Backups showed "Generating..." with no way
  to know why or recover short of restarting the host agent process. Fixed: the function
  now tracks and logs the real failure reason, both `/backup/config` handlers retry
  generation on every request (cheap — one `existsSync` check when a key already exists),
  and the response carries a new `sshPublicKeyError` field. Both clients now show that
  error with a Retry button instead of an endless "Generating...", with a few automatic
  quick retries first to smooth over the normal near-instant case. **Verified for real, not
  just by reading the code**: ran the host agent standalone with `ssh-keygen` deliberately
  removed from `PATH`, confirmed the error surfaced correctly over HTTP and the process
  stayed alive; then made `ssh-keygen` reachable again *without restarting the process* and
  confirmed the very next request generated the key — proving the retry-without-restart
  behavior, not just the initial failure. Also added a numbered "How to set this up" guide
  at the top of Backups on both clients. Docs (`docs/api-reference.md`) updated to match.
- **Web: bottom icon tab bar, mimicking the mobile app's** (`web/src/App.tsx`) — replaced
  the row of plain text tab links under a static "Clocker" header with a fixed bottom bar
  using the same Ionicons the mobile bottom tab navigator uses (via the new `react-icons`
  dependency), icon-over-label, active tab picked out by color. The header now shows the
  current tab's title instead of a static app name, mirroring `app/`'s per-screen
  navigation header. Verified with a real headless-browser pass (see §4) at both a desktop
  and a mobile viewport — including that the fixed bar's `screen` bottom padding actually
  clears scrolled content (a `fullPage` screenshot alone made it look like it didn't;
  scrolling to the bottom in a real viewport confirmed it does).
- **Web: "Last synced" shown above the Refresh button in Settings** (`web/src/store.tsx`
  gained `lastSyncedAt`, set on every successful `refresh()`) — matches what the mobile
  app already showed above its own Sync Now button.
- **Removed a stale leftover Settings message, both clients** — "Prompt for notes on clock
  out has moved to a per-job setting" was never cleaned up after that setting actually
  moved back in `1.2.0`; deleted from both `SettingsScreen.tsx` files (and the
  now-unused RN styles that only supported it, on mobile).
- **Web: Settings/Help moved to a header hamburger menu; bottom bar hardened for narrow
  screens; secondary buttons no longer full-width** (`web` bumped to `1.7.0`, web-only —
  mobile's own bottom tab bar and button sizing were already fine and untouched). The
  bottom bar now only carries the 5 tabs used constantly (Clock/Jobs/History/Timesheets/
  Export); a new `HeaderMenu` in `App.tsx` puts Settings and Help behind a hamburger
  (`IoMenuOutline`) at the header's top right, closing on an outside pointerdown, on
  selecting an item, or implicitly whenever a bottom tab is tapped (clearing the overlay
  state). `SettingsScreen.tsx`'s own "Help" button was removed since Help is now a peer
  destination, not nested under Settings; `HelpScreen.tsx`'s back link text changed from
  "Back to Settings" to "Back" to match. `.tab` gained `min-width: 0` plus an ellipsis
  rule on its label — without `min-width: 0`, a flex item can't shrink below its content's
  natural width, which is exactly what was letting a long label like "Timesheets" push the
  bar wider than the viewport on a narrow phone instead of truncating. `.secondary-button`
  (Refresh, Update Server, Backups, Save Settings, Back Up Now, Add a tier/manager/break,
  etc.) dropped its `width: 100%` in favor of sizing to content — `.primary-button` (Add
  Job, Export, Submit Timesheet) is unchanged and still full width, since those really are
  each screen's one main action. **Verified with the same real-headless-Chromium technique
  as the prior round** (see §4), this time across 320/375/414/768/1280px viewport widths:
  screenshotted the tab bar, the open hamburger dropdown, Settings, Help, confirmed
  clicking a bottom tab while viewing Help correctly closes the overlay and navigates, and
  confirmed a click outside the open dropdown closes it without triggering navigation —
  all at every width, zero console errors.
- **Web: History multi-select was completely unreachable — fixed.** Reported by the user
  as "not working on mobile browser"; turned out to not work anywhere on web at all — the
  only ways to change `selectedIds` all required selection mode to already be active, so
  there was no actual entry point into it. Implemented long-press via Pointer Events (one
  implementation for mouse, touch, and pen — matches `app/`'s `onLongPress` mental model
  without needing separate mouse/touch handling): hold ~500ms without moving more than
  ~10px to enter selection mode; a genuine drag/scroll cancels it. Added `.no-callout`
  (`-webkit-touch-callout`/`user-select: none`, `touch-action: pan-y`) so a mobile
  browser's own text-selection/callout menu doesn't fire mid-press and steal the gesture.
  **Verified for real** with a scripted mouse-held-down long-press (not just reading the
  code): confirmed entering selection mode, selecting a second row without opening its
  editor, Cancel exiting selection mode, and — the negative case — a drag past the row
  correctly NOT entering selection mode.
- **`ShiftEditor`, both clients: "Done" is now a real button; added "Cancel".** Reported
  by the user. "Done" was `.link-button`-styled text; now `.primary`/solid-blue in a
  proper `.modal-actions` footer (mirroring `ShiftNotesModal`'s existing Skip/Save
  pattern) instead of living in the header. Cancel discards the note's draft text without
  saving it — the only field with actual draft state; clock-in/out and break edits above
  each commit immediately via their own date/time picker (the same "commit per
  interaction" pattern used everywhere else in this app), so Cancel can't retroactively
  undo those, and doesn't claim to. Mobile's notes field previously auto-saved `onBlur`,
  which would have made Cancel meaningless (tapping Cancel blurs the field first) —
  removed, so notes now stay a draft until Done on both clients, consistently. **Verified
  for real**: typed a note, hit Cancel, reopened the editor, confirmed it was NOT saved;
  typed a different note, hit Done, reopened, confirmed it WAS saved.
- **Client versions unified into one "project version"** (see §1) — `app`, `web`, and
  `shared` are now kept in lockstep (all `1.8.0`), shown in Settings on both clients.
  `web/vite.config.ts` gained a `define` baking `web/package.json`'s version into
  `__APP_VERSION__` at build time (Vite doesn't expose `package.json` to browser code on
  its own) — confirmed present in a real production build's output JS, not just assumed
  from the config. `server` intentionally stays on its own independent `0.x` track.
- **Hardened `request()` in both clients' `api.ts` against a non-JSON error response** —
  see §4's "Update Server" entry for the real production 405 that exposed this: a
  response body that isn't JSON (a proxy's or static server's own error page, not our
  API's) used to throw an unrelated `JSON.parse` error instead of surfacing the actual
  HTTP status cleanly. Now caught, with a specific inline hint when a 405 hits
  `/update*`/`/backup*` (the exact shape of the external-proxy-routing-gap failure mode).
- **Export's job filter is now a real multi-select, both clients** — reported by the user.
  Was single-select (`jobId: string | "all"`); now `selectedJobIds: Set<string>`, any
  combination, with "Select All"/"Deselect All" next to the "Job" section header.
  Defaults to every job selected the first time jobs load (matching the old "All Jobs"
  default); after that it's purely user-driven — a job added later doesn't silently join
  an already-customized selection, it needs Select All or its own chip. Mobile's
  `listShiftsInRange` query still only takes one optional job ID; rather than teach it an
  `IN (...)` clause for what's normally a short list, both clients now always fetch the
  full range unfiltered and filter client-side by the selected set (web already worked
  this way). **Verified for real** with a scripted run on web: default-all-selected,
  Deselect All, an individual re-toggle, and Select All again, checking the actual chip
  classes after each step — not just reading the code.
- **Mobile: Timesheets' job chips could render badly oversized** — reported by the user
  with a screenshot (a selected chip rendered as a large filled square, and the
  unselected ones nearly as tall). Diagnosed as a specific, well-documented React
  Native-on-Android bug: a horizontal `ScrollView`'s content container defaults to
  `alignItems: stretch` like any flex row, and on Android this can stretch every child to
  the scroll view's full available height rather than just matching sibling content —
  confirmed as the likely cause by checking every other chip row in this codebase
  (Backups' schedule/weekday chips, Export's range/job chips, `JobDetailModal`'s several
  chip rows, Clock's job picker): every single one uses a wrapping (`flexWrap: "wrap"`)
  layout instead of a horizontal `ScrollView`, which structurally can't hit this failure
  mode — Timesheets' job picker was the only one built as a single non-wrapping
  scrollable row. Fixed with the standard remedy (`alignItems: "flex-start"` on the
  container, `alignSelf: "flex-start"` on each chip as a second guard). **Not verified on
  a real device or emulator** (none available this session, same standing limitation as
  every other mobile UI change) — this is a confident diagnosis of a known failure mode
  with its standard fix, not something seen corrected on an actual phone. Watch for this
  specifically the next time someone has one in hand.

- **Full dark/light/system theme, both clients** (`app/src/theme/ThemeContext.tsx`,
  `web/src/theme.tsx`) — a three-way mode (`system`/`light`/`dark`), chosen from a new
  "Appearance" section in Settings, persisted per-client (`AsyncStorage`/`localStorage`)
  and defaulting to `system` (which tracks the OS preference live via `useColorScheme()`
  on mobile, a `prefers-color-scheme` media query on web). Web uses CSS custom properties
  (`:root` for light, overridden under a dark-preference media query and again under an
  explicit `[data-theme="dark"]`); mobile uses a `useTheme()` context exposing a
  `ThemeColors` token object, with every screen/component converted from a module-level
  `StyleSheet.create` to a `useMemo`-wrapped `createStyles(colors)` so restyling actually
  re-renders on a mode change. Both palettes share the same token names/semantics
  (background/surface/card/text/border tiers, primary/danger/success/warning, etc.) so the
  two clients read as the same app. Brand colors (primary, header background/text, white
  text on colored buttons) are deliberately NOT themed — constant in both modes.
- **Header now shows a constant branded app name, both clients** — "Clocker" in the brand
  color, replacing the previous per-screen title (web) / default screen-title header
  (mobile). Which screen you're on is conveyed by the active tab icon instead, mirroring
  how a native app typically separates "app identity" from "current location."
- **Total money earned, both clients**: History now shows a total for pay-eligible shifts
  in the visible range (a `.total-bar`/`totalBar` summary), and the Clock screen shows a
  live "$X.XX so far" figure while clocked in, updating on the same 30s tick as the timer
  — reusing `calculateShiftPay` from `shared` fed the shift's currently-elapsed hours
  instead of a final duration. Timesheets already had pay totals on both clients before
  this session; deliberately left unchanged.
- **Weekly hours remaining now also shows before clocking in** (Clock screen, both
  clients) — for whichever job is currently selected in the picker, using the same
  `calculateWeeklyProgress` already used for an open shift's card, just without the
  "expected clock-out" line (which only makes sense once actually on the clock).
- **History: swipe-to-delete, both clients**, coexisting with the existing long-press
  multi-select. Mobile uses `react-native-gesture-handler`'s `Swipeable` (new dependency,
  `~2.32.0`, requires wrapping the app root in `GestureHandlerRootView` — done in
  `App.tsx`); web uses a custom Pointer Events drag on the same `press` ref that already
  tracks long-press state, so mouse/touch/pen all work through one code path. The delete
  action on both is now a trashcan icon button instead of a text "Delete" button. Web
  verified for real via Playwright, including a tricky edge case: clicking a different row
  while another was swiped open used to correctly close the swipe but ALSO incorrectly
  open that other row's editor (the swipe-dismiss and the row-click were racing); fixed by
  recording that a dismiss just happened and swallowing the very next click. Mobile's
  gesture code is typecheck/bundle-verified only — no device/emulator access this session.
- **Backups: archives section no longer shows any error** — an empty/malformed
  `/backup/archives` response now renders nothing, matching how "Recent Runs" already
  behaved, instead of crashing with "Cannot read properties of undefined (reading
  'archives')".
- **Backups: fixed the SSH-key retry loop's real structural bug.** The polling `useEffect`
  required `config` to already be truthy before it would retry at all — so if
  `/backup/config` itself ever returned a malformed/empty body (the same failure mode
  already known to affect `/backup/archives`), retries never started, leaving "Generating…"
  showing forever with zero recourse. The retry trigger no longer depends on `config` being
  set first; confirmed against the user (who had already redeployed) that this was a real,
  still-reproducing bug and not stale deployment.
- **Export's job filter is now a scrolling checklist, not a wrapping grid of chip
  buttons** — checkboxes + each job's color dot, in a ~180px scrollable list. Explicit
  user request after the multi-select chip version shipped; same Select All/Deselect All
  behavior underneath.
- **Clock screen button relabels**: "Clock In" → "Clock In Now"; the clock-in row's
  "At..." → "Start At..." (clock-out/break "At..." buttons unchanged).

- **Web: reload no longer resets the current tab.** The tab (and Settings/Help overlay)
  is now persisted to `localStorage` on every change and restored on load — previously
  there was no persistence at all, so any browser refresh always landed back on Clock
  regardless of where you'd navigated to. Verified with a real headless-browser pass:
  switched tabs, reloaded twice from two different tabs, confirmed each stuck.
- **Softened the brand blue/red slightly** (`#2563eb`→`#1d4ed8`, `#dc2626`→`#b91c1c`,
  Tailwind's 600→700 step for each) — both clients' header/primary-button color and
  default job-color palette (the first swatch every new job gets, and the actual biggest
  source of "bright blue" day-to-day since it shows up as badges/dots throughout Clock,
  History, Timesheets, and Export). Deliberately did NOT touch dark mode's own red
  variant (`#f87171`), which was already a muted, contrast-adjusted tone by design.
- **Backups, both clients: in-app instructions for a dedicated remote backup user.** A
  new "Set up a dedicated backup user on the remote server" toggle under the generated
  SSH key prints copy-pasteable shell commands (web: Copy button; mobile: `Text
  selectable`, tap-and-hold) that create a restricted system account (real `/bin/bash`
  shell, mirroring Haydrop's own documented setup almost line-for-line — a `nologin`
  shell was originally used here and broke the backup entirely; see the real-bug-fix
  entry right below for why), the repository directory, and an
  `authorized_keys` entry locked to `borg serve --restrict-to-repository ...` — so the
  key can't do anything beyond running backups even if leaked. Generated by a new shared
  helper, `shared/src/backupRemoteSetup.ts` (parses the already-typed "Repo URL" for a
  `user@host:path` to prefill the script's host/path, falling back to the convention
  `docs/deployment.md` already documented) — `docs/deployment.md#the-host-agent` now
  points at this generator instead of carrying a separate hand-written snippet that could
  drift from it. Verified for real via Playwright: toggle opens, script contains the
  expected commands, and typing a repo URL correctly re-derives the host/path shown in
  the script.

- **Real bug (2026-09-12, reported by the user on a real first backup attempt): the
  generated remote backup user script used `nologin` as the account's shell, which
  broke the backup entirely.** Symptom: `borg init failed: Got unexpected RPC data
  format from server: This account is currently not available.` — that exact string is
  `nologin`'s own banner, not a Borg error. Root cause: sshd runs an `authorized_keys`
  `command="..."` forced command *through the account's configured login shell*
  (`<shell> -c "<command>"`) — with `nologin` (or `/bin/false`) as that shell, the forced
  `borg serve` command never actually runs; the shell just prints its "not available"
  banner and exits, which is what Borg saw instead of the RPC handshake it expected.
  Fixed in `shared/src/backupRemoteSetup.ts`: the generated script now uses a real shell
  (originally `/bin/sh`, later changed to `/bin/bash` to mirror Haydrop's own setup more
  closely — see the later "mimic Haydrop's setup block" entry below) — the
  `restrict`+`command=` entry in `authorized_keys` already fully locks the account down
  regardless of shell, so this doesn't reopen anything security-wise. **This does NOT
  retroactively fix an account already created on a real remote server** — the user needs
  to run `sudo usermod -s /bin/bash clocker-backup` (or their actual username) on that
  server themselves; flagged to them directly, not something fixable from this repo alone.

- **Real bug (2026-09-12, same real backup attempt, reported right after fixing the
  above): a "Repo URL" missing its `:path` failed with a confusing error deep inside
  Borg instead of a clear one.** Symptom: `borg create failed: Repository
  /tmp/clocker-backup-XXXXXX/user@host does not exist.` Root cause: Borg only treats a
  URL as remote when it's `ssh://...` or matches `user@host:path` exactly — `user@host`
  alone (no colon) is silently treated as a plain LOCAL path instead, resolved relative
  to wherever `borg` happens to be invoked from (a per-run temp staging directory here,
  hence the `/tmp/...` prefix). Briefly (`1.12.0`) added a `validateRepoUrl` check
  rejecting this shape at save/run time, **then removed it again in `1.13.0` per explicit
  instruction**: the user's Haydrop app uses the exact same kind of feature against the
  same Borg server and never validates this field either — it just passes whatever's
  typed straight to `borg`, and that's the preferred behavior here too (see Haydrop's own
  `api/src/services/backup.ts`/`docs/deployment-guide.md`, which confirms Haydrop's setup
  guide actually still uses a full explicit path AND a real shell, `/bin/bash` — the same
  real-shell fix landed here independently above; only the validation itself was
  reverted). Settings → Backups now accepts any "Repo URL" (trimmed of whitespace only)
  with no format checking, same as before `1.12.0` — Borg's own requirement for
  `user@host:path`/`ssh://...` to be recognized as remote hasn't changed, this app just
  no longer tries to catch a mismatch upfront.

- **"Update Server" (and `npm run update`) now tolerate a locally modified
  `package-lock.json` on their own, not just when it's the *only* dirty file** —
  `1.11.0` (this is `scripts/`/deploy-tooling, not client code, but per §1's revised
  versioning policy every repo change still bumps the one unified version). Previously
  a real `npm install` run directly on the host (as happened during this session's live
  incident, see §4) could leave `package-lock.json` git-dirty in a way that would have
  permanently 409'd the "Update Server" button (it required a fully clean tree) even
  though that drift is always safe to discard — `npm install` regenerates the lockfile
  fully on every run regardless. New shared helper, `discardSafeLockfileDrift` in
  `scripts/lib.mjs`, used by both `scripts/update.mjs`'s local `git pull` and
  `scripts/host-agent.mjs`'s `/update` handler: discards a dirty `package-lock.json`
  outright unless `package.json` is *also* dirty (that pairing usually means an
  intentional, uncommitted dependency change in progress, not just drift — left alone as
  a real uncommitted change in that case).

- **Backups: disaster recovery, ported from Haydrop.** Settings → Backups (both clients)
  has a collapsed-by-default "Disaster recovery: restore from another location" section —
  lists and restores from any repository URL/passphrase typed in on the spot, entirely
  independent of the saved backup config, for recovering onto a fresh install or one whose
  own saved settings were themselves lost. `scripts/host-agent.mjs`'s `listArchives`/
  `restoreBackup` now take an optional `repo` override (same shape as Haydrop's service
  layer); two new routes (`POST /backup/disaster-recovery/archives`,
  `POST /backup/disaster-recovery/restore`) are thin wrappers with no new restore logic.
  `ArchiveRestoreRow` (both clients) generalized to accept an optional `repo` prop so the
  normal Archives list and the new DR section share the exact same restore-confirmation
  UI, mirroring Haydrop's own `RestorePanel` reuse. Unlike Haydrop (whose disaster
  recovery still needs a DB-backed admin session, hence an already-bootstrapped install),
  this needs nothing beyond a valid JWT — the host agent's auth check has no database
  dependency at all, so it survives even a fully destroyed `clocker` app/database as long
  as `.env.prod`'s `JWT_SECRET` is intact and a device already holds a token. **Verified
  for real**: a standalone host-agent instance correctly rejected requests without auth
  (401), rejected missing `repoUrl`/`passphrase` (400), surfaced a real `borg`-level
  failure without crashing (400, process stayed alive) for both list and restore, and the
  restore path was confirmed to actually use the ad-hoc repo (not the empty saved config)
  by inspecting its own failure log. Also confirmed via Playwright that the web UI's
  "List Archives" button reaches the host agent and surfaces its real error inline.
- **History: filtering, both clients.** A collapsible "Filters" toggle (default collapsed,
  preserving the exact same "last 90 days, every job" default view History always
  showed) revealing the same date-range chips + job multi-select checklist Export already
  had — `RangeKey`/`RANGES`/`rangeFor`, previously duplicated between the two
  `ExportScreen.tsx` files, hoisted into a new `shared/src/dateRanges.ts` now that a third
  (and fourth, mobile) consumer needed the same logic, so Export and History can't drift
  apart on how a given preset is computed. Web filters an already-in-memory array
  (`store.shifts`) client-side; mobile re-queries SQLite (`listShiftsInRange`) whenever the
  date range changes and filters the result to selected jobs client-side, mirroring
  Export's own app-side approach exactly (`useDbRefresh(useCallback(..., [range,
  selectedJobIds]))`). A shift selected for bulk-delete is now cleared whenever the filter
  changes, so the "N selected" count can't drift out of sync with what's actually visible
  and deletable. **Verified for real via Playwright** (web): filter toggle/summary line,
  date chips, job checklist all render; deselecting a job correctly hides its shift and
  re-selecting brings it back; a custom range with no matching data correctly shows the
  "No shifts match the current filter" empty state. Mobile verified via a clean
  `expo export` bundle compile only — no device/emulator access this session.
- **Remote backup user setup script now mimics Haydrop's own documented setup block
  almost line-for-line**, per explicit instruction with the exact block to match:
  `adduser --system --group --shell /bin/bash --home ...` instead of `useradd`,
  `install -d -o -g -m 700 ...` instead of separate `mkdir`+`chown` calls, `touch`+
  `chown`+`chmod 600` for `authorized_keys` instead of relying on a directory-level
  `chmod -R`, and an explicit `sudo apt update && sudo apt install -y borgbackup
  openssh-server` up front (previously just a trailing `apt install borgbackup` comment —
  `openssh-server` wasn't called out at all, even though `borg serve` needs it running on
  a headless box that might not already have it). Home directory moved from
  `/home/clocker-backup` to `/srv/clocker-backup` (matching Haydrop's own layout, where
  home and the repository both live under one `/srv/<user>/` tree) — the repository path
  itself, `/srv/clocker-backup/repositories/clocker`, was already there and unchanged.
  Shell changed from `/bin/sh` to `/bin/bash`, matching Haydrop's exact choice (both are
  "a real shell, not nologin" for the reason already fixed in the entry above — this is a
  style match, not a second fix). Still generates the actual `command="borg serve
  --restrict-to-repository ...",restrict <key>` line automatically via `echo | tee -a`
  rather than leaving that as a fully manual step the way Haydrop's own docs do, since
  this app already has the real public key value on hand to fill in.
- **Import from Hours Tracker, both clients** — Settings → Import Data
  (`{app,web}/src/screens/ImportScreen.tsx`) reads a CSV export from the Hours Tracker
  app and creates jobs/shifts/breaks from it. Parsing is pure and shared
  (`shared/src/importFormat.ts`): a hand-rolled RFC4180-ish CSV parser (quoted fields,
  embedded commas/newlines, `""` escaping — no dependency, matching this package's
  dependency-free design), an explicit `M/D/YYYY h:mm AM/PM` date parser (not handed to
  `new Date(string)`, since that isn't guaranteed to parse identically on V8 vs. Hermes),
  and a break-time-of-day resolver that anchors each break (and the rare
  midnight-spanning shift) to whichever calendar day actually places it inside its
  shift's own clock-in/out range. `Comment`/`Tags`/`Adjustments`/`Mileage` all fold into
  the shift's one notes field; `Duration`/`Earnings` are deliberately NOT imported —
  Clocker computes pay itself from the exact clock-in/out/break timestamps rather than
  trusting Hours Tracker's own already-rounded totals. A job whose name exactly matches
  an existing one gets its shifts added to it (that job's own rate configuration is never
  touched); any other name creates a new job with an auto-cycled color and a single
  "Standard" rate tier using whichever hourly rate appears most often across that job's
  rows, backdated to that job's earliest imported shift — required a small extension to
  `createJob`/`createRateTier` on both clients (`rateEffectiveFrom`/`effectiveFrom`,
  optional, defaults to "now" exactly as before) since pay calculation only ever looks at
  the rate version active *at a shift's own clock-in time*, and a version effective
  "now" would leave every imported (necessarily historical) shift showing $0. A shift
  already present (same job, same clock-in timestamp) is skipped, making a re-import of
  the same or an overlapping file safe. Preview-then-confirm UX: shows shift/job counts
  (and which job names are new) before writing anything, plus a summary after.
  - **Deliberately different write strategies per client, for performance, not
    correctness**: web has no local database, so the one-row-at-a-time store actions
    (`clockIn`/`clockOut`/...) would each cost a network round-trip *and* trigger a full
    `refresh()` re-pull of the entire dataset (see store.tsx's own comment on why) — for
    a few hundred rows that's much too slow, so `web/src/lib/importHoursTracker.ts`
    builds every new Job/RateTier/RateVersion/Shift/Break record directly and pushes them
    all in one `pushChanges` call instead (that function already accepts full arrays).
    Mobile's local SQLite writes are fast enough that this doesn't matter, so
    `app/src/lib/importHoursTracker.ts` just loops through the normal
    `clockIn`/`clockOut`/`startBreak`/`endBreak` functions sequentially, gaining the same
    outbox/pending-change bookkeeping every other write already gets for free instead of
    a second hand-rolled insert path that could drift from it.
  - Documented in `docs/import-format.md` (full column-by-column reference, linked from
    `docs/README.md`) and in both clients' in-app Help screen; the exact expected header
    row (`HOURS_TRACKER_CSV_HEADER`, exported from the shared parsing module) is shown
    inline on the Import screen itself, so the doc/code/UI can't drift apart on it.
  - **Verified for real against a genuine Hours Tracker export** (the user's own,
    286 rows, 5 distinct jobs including one with multiple same-shift breaks and one
    midnight-spanning shift): the standalone parser correctly produced 286 rows with
    zero errors; a full Playwright run through the actual web UI (file upload → preview →
    import → confirmed in Jobs and History) created exactly the 5 expected jobs and 286
    shifts, with History's total-earned figure landing within a few percent of the CSV's
    own reported total — the remaining gap is expected, not a bug: Hours Tracker's own
    `Duration`/`Earnings` columns are themselves rounded per shift, while Clocker's
    figure comes from exact timestamps. Mobile verified via a clean `expo export` bundle
    compile only (file-picking itself needs a device) — uses `expo-file-system`'s own
    built-in `File.pickFileAsync`, so no new native dependency was needed (an initial
    `expo-document-picker` install was reverted once this was discovered).
- **Mobile: Settings/Help moved behind a header hamburger menu, matching web's layout.**
  `app/src/navigation/RootNavigator.tsx`'s bottom tab bar is now Clock/Jobs/History/
  Timesheets/Export — 5 tabs, same as web — with Settings and Help removed as tabs
  entirely. A `menu` icon added via `headerRight` opens a small dropdown (Settings, Help)
  rendered as a genuine sibling of `<Tab.Navigator>` rather than nested inside
  `headerRight`'s own layout slot — necessary because the dropdown's full-screen dismiss
  backdrop (`Pressable` + `StyleSheet.absoluteFill`) needs to cover the whole screen
  including the tab bar, which it can't do from inside the header's own small bounding
  box. Positioned via `useSafeAreaInsets()` plus a per-platform approximate header height
  constant rather than `@react-navigation/elements`' `useHeaderHeight()`, since that hook
  only works from inside the navigator's own header context and this dropdown is
  deliberately rendered outside it — a few pixels of imprecision is an acceptable trade
  for not needing a device to re-verify every time the header's own styling changes.
  `SettingsScreen.tsx` gained an `onClose` prop and is now presented as a slide-up
  `Modal` with its own `ScrollView` and "Done" button, matching Backups/Import Data's
  existing structure exactly; its own internal "Help" button was removed since Help is
  now a peer hamburger destination, matching web's own `SettingsScreen.tsx` (Backups and
  Import Data stay as buttons nested inside Settings on both clients, unchanged).
  - **Real bug found and fixed along the way**: `SettingsScreen`'s content sat in a plain
    `View`, not a `ScrollView` — on any device where Appearance/Last synced/App version/
    Server/Backups/Import Data/Sign Out together were taller than the visible area
    (confirmed by the user's own screenshot showing "Backups" clipped at the very bottom
    edge, just above the tab bar), everything past that point was genuinely unreachable,
    not merely visually tight. Fixed as part of the same restructuring, which needed a
    real `ScrollView` anyway to match the Backups/Import Data modal pattern.
  - **Not verified on a real device or emulator** (none available this session, same
    standing limitation as every other mobile UI change) — verified via a clean
    `tsc --noEmit` and `expo export` bundle compile, plus careful reasoning through React
    Native's absolute-positioning model for why the dropdown backdrop needed to move
    outside `headerRight`'s slot (an `expo-router`/`@react-navigation/elements`
    `useHeaderHeight()` attempt was tried first and reverted after realizing it throws/
    misbehaves outside the header's own context — caught by reasoning about the context
    boundary, not by running it). Worth a real-device pass to confirm the dropdown's
    approximate vertical position actually lands just under the header as intended.
- **Jobs screen (both clients): archived jobs now sort to the bottom.** Reported by the
  user via a screenshot showing two archived (struck-through) jobs interleaved
  alphabetically at the top of the list, ahead of every active job. Mobile's `listJobs`
  query already sorted alphabetically via SQL (`ORDER BY name COLLATE NOCASE`) — added a
  stable secondary sort in `JobsScreen.tsx` itself (`Number(a.archived) - Number(b.archived)`)
  that moves archived jobs after active ones without disturbing the alphabetical order
  already established within either group. Web's server returns jobs in no particular
  order at all, so `web/src/screens/JobsScreen.tsx` now does the full sort itself
  (archived-last, then alphabetical, `localeCompare` with base sensitivity to match
  SQL's case-insensitive collation) — different implementations, identical resulting
  behavior on both clients.
- **Archived jobs hidden everywhere except the Jobs screen, both clients**, per explicit
  instruction: "if a job is archived, hide it everywhere but the jobs page." Clock
  already excluded archived jobs from its job picker on both clients (unchanged); fixed
  the three spots that didn't:
  - **Export**: mobile's `load()` switched from `listJobs(true)` to `listJobs(false)`;
    web's job checklist, its default-select-all-on-load effect, and Select All all now
    filter through a new `activeJobs` memo instead of `store.jobs` directly.
  - **History**: same treatment on both clients (mobile `listJobs(false)`; web's
    checklist/`allJobsSelected`/Select All all reading from an `activeJobs` memo).
  - **Timesheets**: mobile's `listJobs(false)`; web's job-chip selector and its
    auto-select-first-job effect now read from an `activeJobs` memo, so a job that gets
    archived while selected automatically falls through to the next active one.
  - `ImportScreen`'s job-name matching deliberately still sees archived jobs (via
    `listJobs(true)`/`store.jobs` unchanged) — that's matching against existing data to
    avoid creating a duplicate job on re-import, not a picker UI, so it's outside the
    scope of "hide archived jobs" and was left alone on purpose.
  - **Jobs screen itself**: now hides archived jobs by default too (the one screen where
    they're still reachable at all), with a "Show Archived Jobs (N)" / "Hide Archived
    Jobs" toggle — count only shown when there's at least one archived job. Empty-state
    messaging distinguishes "no jobs at all" from "no *active* jobs, N archived hidden."
  - **Verified for real via Playwright** (web): created an active job and an
    archive-bound job, archived the second, and confirmed it disappeared from Clock's
    picker, Export's checklist, History's checklist, and Timesheets' chips — and from
    the Jobs screen itself until "Show Archived Jobs" was clicked, then reappeared, then
    hid again on toggling back. Mobile verified via a clean `expo export` bundle compile
    only — no device/emulator access this session.

## 4. Known gaps / open work

- **Real incident (2026-09-12): `clocker-host-agent` was crash-looping in production on
  `nextcloud`** (`ERR_MODULE_NOT_FOUND: node-cron`, pm2 showing 5+ restarts) — `node-cron`
  had been added to root `package.json` in an earlier session but `npm install` was never
  re-run on the host afterward, so every start attempt died before the process could even
  open its listening port. This explained BOTH a live 502 on "Update Server" (nothing
  reliably listening on `HOST_AGENT_PORT`) and the backup SSH key staying stuck on
  "Generating…" forever (the process never survived long enough to run `ssh-keygen`).
  Fixed live, with the user's explicit one-time permission to SSH in: `npm install` +
  `pm2 restart clocker-host-agent` on `nextcloud`; confirmed the process then stayed up,
  answered on port 4002, and the SSH key file appeared on disk. The external Caddy config
  on `webproxy` was separately confirmed already correct (`/backup*`/`/update*` `handle`
  blocks present, pointing at the right port) — this incident was NOT a proxy-config
  problem, unlike the similar-looking 405 diagnosed in an earlier session. **Lesson**: a
  plain `git pull` (or even a prior `npm install` that ran before a new dependency was
  added) does not retroactively install packages added since — any session that adds a
  new host-agent dependency should flag that the next real deploy/update on the host must
  run `npm install` at the repo root before restarting `clocker-host-agent`, not just pull
  code.

- **EAS/Expo account never logged into from any Claude session.** `app/app.json` has no
  `extra.eas.projectId` — confirmed absent as of this audit. Needs an interactive
  `eas login` + `eas update:configure` with Jason's own Expo account before OTA updates or
  `npm run deploy`'s EAS-build step can work. First `eas build` after that is also
  interactive one more time (links the EAS project) — deploy script deliberately doesn't
  pass `--non-interactive` for this reason (see commit `d69b080`). If Jason has since done
  this himself outside a Claude session, re-check `app/app.json` before assuming this gap
  still stands.
- **The persistent "clocked in" notification has never been built or run** — it's the
  first feature in this project that genuinely requires a custom dev/production build
  rather than Expo Go, so it's also blocked on the EAS gap above in practice. First real
  test should happen on an actual Android device, watching for: the foreground service
  actually starting, the notification surviving the app being backgrounded/swiped from
  recents, and correct behavior when clocked into more than one job at once.
- **JWT refresh isn't implemented** — a "remember me" token (default) never expires, with
  no revocation short of rotating `JWT_SECRET` (logs out every device). Accepted as fine
  for personal/single-user use; flagged as a real gap in
  `docs/deployment.md#security-gaps-to-close-before-this-is-public`.
  (CORS restriction and a bot-filtering CAPTCHA/rate-limiting on `/auth/login`/
  `/auth/register`, previously listed here as gaps, have both since shipped — see §3. The
  refresh-token gap above is the only item left in that doc section.)
- **The "Update Server" button has now actually been tried against the real `nextcloud`
  host (2026-09-12) and failed with a 405** clicking it from the web client. Diagnosed
  (no SSH access this session to confirm directly): the user's `nextcloud` deployment uses
  `PROXY_MODE=external` (a separate Caddy on another machine — see the deployment target
  note above), and a 405 on a POST is exactly what you'd get if that external proxy's
  config predates the `/update*`/`/backup*` `handle` blocks being added (host agent
  shipped in `1.1.0`) — the request would fall through to the catch-all, hit the `web`
  container's own static file server, which only answers GET/HEAD. **Action for the user**:
  re-run `npm run deploy -- <domain> --external-proxy` on that host and paste the printed
  Caddy snippet into the external proxy's config, replacing whatever's there now — the
  exact `handle` blocks needed are in `scripts/deploy.mjs`'s printed output. Separately
  hardened `request()` in both clients' `api.ts` this session: a non-JSON error body (a
  static file server's own 405 page, not our API's JSON) used to throw an unrelated
  `JSON.parse` error instead of a clean status message; now caught, and a 405 on
  `/update*`/`/backup*` specifically gets an inline hint pointing at this exact cause.
  Also confirmed via a second screenshot the same day: the live site's web bundle already
  reflects newer commits (the header hamburger menu was visible) but Settings → Backups
  still showed the pre-fix "Generating..." key UI with no error — meaning the `web`/
  `server` Docker containers were rebuilt more recently than `scripts/host-agent.mjs` was
  restarted (a `git pull` alone doesn't restart a separately-managed pm2 process; that
  needs `pm2 restart clocker-host-agent`, or a full `npm run deploy` run that gets far
  enough to reach that step). **Also fixed a real remaining gap this exposed**: if an
  older host agent (predating `sshPublicKeyError`) never sends that field, the key UI
  used to just stay on "Generating..." forever once the auto-retry budget was spent, with
  no error and no way out. Both `BackupsScreen.tsx`s now show a manual Retry regardless of
  whether a specific error string is available, once retries are exhausted.
- Also untested: whether the bundled Caddy's `host.docker.internal` route actually
  resolves on the real host's Docker version/OS (added `extra_hosts: host-gateway` for
  Linux, but this wasn't verified against a running container — only that Docker Compose
  accepted the config). Moot for `nextcloud` specifically since it uses `external` mode.
- **BorgBackup has never run against a real `borg` binary** — not installed on the dev
  machine this was built on (see §3 for exactly what *was* verified: the HTTP/config/guard
  layer, and a real crash bug caught and fixed in it). Needs `apt install borgbackup` (or
  equivalent) on the real host before Settings → Backups can do anything beyond configure
  itself. First real backup and first real restore should both be watched closely.
- **Web client's real-browser click-through pass** — the original feature-parity work
  (Jobs editor, Clock, History, Export, Timesheets) was verified by typecheck + production
  build + a scripted store-action replay, not yet by a human actually clicking through.
  The 2026-09-12 session (bottom tab bar, Help, Backups walkthrough/key-error UI) *was*
  driven end-to-end with a real headless Chromium (Playwright, via a throwaway path-router
  proxy standing in for Caddy) at both desktop and mobile viewports, screenshots taken at
  every step and inspected — but that's an automated pass, not the same as an actual human
  clicking through, and it doesn't cover the earlier-shipped screens. Worth a real
  human pass before fully trusting either.
- **iOS EAS builds** need a paid Apple Developer membership + `eas device:create` — not
  done; Android internal-distribution builds are the tested path.
- **No live device/emulator screenshot verification** has been done from any Claude
  session (no emulator/device was reachable in-session) — if UI looks off anywhere, a
  real-device pass is the most likely place to catch something typecheck can't.
- **No open GitHub issues** — `gh issue list` returned empty against `jasonhaymond/Clocker`
  (gh CLI is authenticated as `jasonhaymond`) at time of this audit.
- ~~Live deployment's actual current ports are unverified from this repo~~ — **resolved
  this session, and this is exactly the kind of thing that bites in production**: the
  external Caddy proxy on the OTHER machine had `/health`/`/auth/*`/`/sync/*` pointed at
  port 3003, but the actual running server had settled on a different port (3002 was
  confirmed reachable directly at the time; the web catch-all's port, 3005, was already
  correct in that same proxy config, so only the server's three blocks were stale). Result:
  the web page loaded fine (served by the correctly-pointed web port) but every API call
  502'd — "Add Job does nothing," Settings' Refresh showing "Request failed (502)." Fixed
  by hand-correcting the proxy's three server blocks to the real `SERVER_PORT` from
  `.env.prod`. **The general lesson, not yet automated**: nothing currently keeps an
  external proxy's config in sync with `.env.prod`'s ports after they're first set —
  `npm run deploy` only ever *prints* the correct block, it doesn't detect or warn when
  the live proxy config has drifted from it. Re-verify `.env.prod`'s current
  `SERVER_PORT`/`WEB_PORT` directly on `nextcloud` before assuming any specific numbers
  are still current, and cross-check them against the external proxy's actual config if
  anything is 502ing.

## 5. Deployment

Full detail: **`docs/deployment.md`** (long, step-by-step, has its own troubleshooting
and "security gaps" sections — read it before touching production).

- **Real target**: a host named `nextcloud`, reached via `ssh jason@nextcloud`, home dir
  `~/Clocker`, live at `https://clocker.haymondtechnologies.com`. That host's *other*
  services run a separate Caddy instance on a *different* machine, so Clocker either runs
  its own bundled Caddy (`PROXY_MODE=local`, the default) or prints a config snippet for
  hand-editing that other machine's Caddy (`PROXY_MODE=external`) — this hasn't changed
  since the prior session and nothing in this audit contradicts it, but it wasn't
  independently re-verified (no SSH access from this session).
- **`npm run deploy`** (`scripts/deploy.mjs`) is the one-command production deploy:
  auto-generates `.env.prod` secrets, takes an unconditional pre-deploy `pg_dump` snapshot
  to `backups/clocker-<timestamp>.sql` (skipped gracefully if no DB exists yet — added in
  the most recent commit, `9004c7d`), brings up the Compose stack, self-verifies
  (container health, DNS, a health-endpoint curl through Caddy), then submits an EAS build
  (`--platform android --profile preview` by default, `--no-wait`) unless `--skip-app`.
- **Web is deployed unconditionally alongside the server**, same domain, path-routed by
  Caddy (`/health`, `/auth/*`, `/sync/*` → server; everything else → web's static build) —
  not a separate subdomain, not opt-in.
- **`npm run deploy` now also starts/restarts a host-side `clocker-host-agent` pm2 process**
  (`scripts/host-agent.mjs`), auto-picking `HOST_AGENT_PORT`/`HOST_AGENT_BIND` and routing
  `/update*` and `/backup*` alongside the other paths, so the in-app "Update Server" and
  Settings → Backups (§3) work. Falls back to printing manual pm2/systemd instructions if
  pm2 isn't installed on the host — nothing here has been confirmed against the real
  `nextcloud` host yet (§4). Requires `borg` installed on the host separately (`apt install
  borgbackup`) for the backup half specifically — the host agent itself starts fine
  without it, just warns and fails backup/restore attempts until it's present.
- **Ports are now stable across redeploys** (fixed in `d69b080`, 2026-09-11): a port is
  only scanned-for-free the *first* time a deploy runs (`SERVER_PORT`/`WEB_PORT` unset in
  `.env.prod`); once written, it's reused unconditionally on every later redeploy, never
  re-checked. This was a deliberate fix for a bug where redeploys kept incrementing ports
  forever, because a plain socket-bind check couldn't tell "taken by something else" from
  "taken by this same stack's own already-running container." If a configured port is ever
  genuinely stolen by something unrelated while the stack is down, `docker compose up`
  fails loudly with "port already allocated" — fix by hand-editing `.env.prod`, same as a
  dev-port change.
- **`PROXY_MODE`**: `local` (default, bundles Caddy, needs 80/443 free) or `external`
  (`docker-compose.prod.external-proxy.yml`, no bundled Caddy, publishes server/web ports
  directly for your own existing proxy to reach — auto-picks `SERVER_PORT` then `WEB_PORT`
  starting after it, per the stability rule above).
- **`npm run deploy:app`** (`scripts/deploy-app.mjs`) — lighter OTA-only update path, no
  cloud build. Blocked on the same EAS-login gap as §4 until `eas update:configure` has
  been run once.
- Restore-from-snapshot has been exercised for real (create row → redeploy/snapshot →
  truncate → restore → row confirmed back), per `docs/deployment.md#database-backups`.

## 6. Project-specific gotchas

- **`@types/react` pinned to exact `19.2.2`** in `app/package.json` (confirmed present) —
  anything above it breaks TS checking of every RN core component (TS2607/TS2786), an
  upstream regression reproduced even in a bare `create-expo-app`. Re-check this pin after
  any `npx expo install` run — it has silently reverted the pin to a caret range before.
- **Dev ports (5433 Postgres / 3001 API) are picked by `npm run setup`, and *re-verified
  on every run*** (unlike prod, see §5) — this is intentional per-run freshness for local
  dev, documented in `docs/development.md#automatic-port-selection`.
- **`package-lock.json` can show falsely modified on Windows** (LF/CRLF) after
  `npm install` — mitigated by root `.gitattributes` (`* text=auto eol=lf`) plus
  `scripts/lib.mjs`'s `discardSafeLockfileDrift` (2026-09-12: broadened beyond the
  original "only the lockfile is dirty" carve-out to discard it regardless of what else is
  dirty, as long as `package.json` isn't *also* dirty — see §3/§4). Shared by both
  `scripts/update.mjs`'s local `git pull` and the "Update Server" button's production
  flow (`scripts/host-agent.mjs`), so the two can't diverge on this rule. If `git pull`/
  `npm run update`/Update Server ever still blocks on this (i.e. `package.json` really is
  also dirty, or something else entirely is), `git checkout -- package-lock.json` by hand
  first, or resolve whatever else is actually dirty.
- **Feature-parity policy** (`CLAUDE.md`, repo root) — every client must expose the same
  features; a platform constraint is a reason to adapt the mechanism, not drop the
  feature; new features land on both clients in the same unit of work.
- **Prisma client generation on Windows** has a documented known issue/workaround — see
  `docs/development.md#known-issue-prisma-client-generation-on-windows` (not re-verified
  in this audit, just confirmed the section still exists).

## 7. Recent history highlights

**`CHANGELOG.md` (started 2026-09-11) is now the authoritative "what shipped" record for
`1.1.0` onward — read it instead of trying to keep an exhaustive commit list current
here.** Everything before that, plus full commit-level detail for anything after, is
`git log` (`25c1daf` most recent — the `1.17.0` commit: mobile hamburger nav + Settings
scroll fix, Jobs archived-sort fix, and hiding archived jobs everywhere but the Jobs
screen, all described in §3 above). A few highlights predating the changelog,
newest-first, kept for orientation rather than completeness:

- `f157682` Add full shift editing (times, breaks, notes) on both clients
- `ab55f88`/`fbc3d9f` Added STATUS.md, then had to recover it after overwriting it without
  reading first — see §6 lesson on always reading before writing
- `d55fcc8` Surface store action failures via a global error banner
- `9004c7d`/`d69b080` Mandatory pre-deploy DB snapshot; fixed incrementing-ports and EAS
  non-interactive deploy bugs
- `db897b0`/`cb18a21`/`5886a91`/`68e5fda`/`60a57e0` Web client brought to full feature
  parity, folded into `npm run deploy`, and deployed on the same domain as the API
- Earlier: initial scaffold, docs, dev-port auto-selection, rate tiers/overtime/CSV/email
  export, Caddy deployment, Manager/Timesheets/rounding features — see full `git log`.

**Working tree**: clean as of `25c1daf` above (`git status` — nothing staged or
modified), pushed to `origin/master` this session. One stray untracked file still exists
(present since at least the last audit, deliberately left alone again):
`app/assets/2A87F0F4-4604-43E5-88A9-353575B87AD4-05daea287739b47c27cea4102e72ecd9.lrprev`
— a Lightroom preview file, not project-generated; almost certainly an accidental drop
into the repo tree (this whole project lives under a Nextcloud-synced folder). Worth
deleting or `.gitignore`-ing, not investigating further.

## 8. Pointers (don't duplicate these — read them)

- **`README.md`** — quick start, features list, "Notes for future work."
- **`CLAUDE.md`** — this project's own standing policy (feature parity). Governs; not
  restated in full here.
- **`docs/README.md`** — index into the full doc set.
- **`docs/architecture.md`**, **`docs/data-model.md`**, **`docs/sync-protocol.md`**,
  **`docs/api-reference.md`**, **`docs/development.md`**, **`docs/deployment.md`** — see
  §2/§5/§6 above for what's in each; all six confirmed present and current as of this
  audit.
- `~/.claude/CLAUDE.md` (global, cross-project) — baseline standards this project inherits
  and narrows via its own `CLAUDE.md`.
