# Clocker — Status

Read this first if you're a new Claude session with no memory of this project. It's a
snapshot of where things stand, not a spec — the docs it points to are the source of
truth for anything that might have changed since.

**Written:** 2026-09-11, after auditing the actual repo (git log, git status, docs/,
package.json files, app/eas.json, app/app.json) against a detailed prior-session memory
dump. Everything below was verified against the repo at that date; treat it as possibly
stale by the time you read it — re-check anything load-bearing (`git log`, `git status`,
the relevant doc) before acting on it.

## 1. What this is

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

npm workspaces monorepo (`shared`, `app`, `server`, `web`). No CHANGELOG.md exists —
version/change history lives only in `git log` (see §7). `app/package.json` and
`web/package.json`/`shared/package.json` are at `1.0.0`; `server/package.json` is at
`0.1.0`.

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

## 4. Known gaps / open work

- **EAS/Expo account never logged into from any Claude session.** `app/app.json` has no
  `extra.eas.projectId` — confirmed absent as of this audit. Needs an interactive
  `eas login` + `eas update:configure` with Jason's own Expo account before OTA updates or
  `npm run deploy`'s EAS-build step can work. First `eas build` after that is also
  interactive one more time (links the EAS project) — deploy script deliberately doesn't
  pass `--non-interactive` for this reason (see commit `d69b080`). If Jason has since done
  this himself outside a Claude session, re-check `app/app.json` before assuming this gap
  still stands.
- **Editing a shift's clock-in/out time from History isn't built** — delete+recreate is
  the workaround (notes/comments ARE editable). Documented in root `README.md`.
- **JWT refresh isn't implemented** — 180-day fixed expiry, no revocation short of
  rotating `JWT_SECRET` (logs out every device). Accepted as fine for personal/single-user
  use; flagged as a real gap in `docs/deployment.md#security-gaps-to-close-before-this-is-public`.
- **No rate limiting on `/auth/login` or `/auth/register`**, and CORS is `{ origin: true }`
  (permissive) — both flagged in the same security-gaps doc section as pre-public-launch
  work, not yet done.
- **Web client's real-browser click-through pass** — parity work was verified by
  typecheck + production build + a scripted store-action replay against a real local
  server, not yet by a human actually clicking through in a browser. Worth doing before
  fully trusting it.
- **iOS EAS builds** need a paid Apple Developer membership + `eas device:create` — not
  done; Android internal-distribution builds are the tested path.
- **No live device/emulator screenshot verification** has been done from any Claude
  session (no emulator/device was reachable in-session) — if UI looks off anywhere, a
  real-device pass is the most likely place to catch something typecheck can't.
- **No open GitHub issues** — `gh issue list` returned empty against `jasonhaymond/Clocker`
  (gh CLI is authenticated as `jasonhaymond`) at time of this audit.
- **Live deployment's actual current ports are unverified from this repo.** `.env.prod`
  (where `SERVER_PORT`/`WEB_PORT` for `PROXY_MODE=external` actually live) is gitignored
  and only exists on the real `nextcloud` host — it is not in this repo and wasn't
  fetched for this audit. A prior session's memory claimed the live ports had "settled at
  3002/3005," but the actual bugfix commit (`d69b080`) that made ports stable describes
  its own verification run landing on 3001/3002, not those numbers — treat the specific
  3002/3005 figure as unconfirmed, and check `.env.prod` on the `nextcloud` host directly
  (or ask Jason) before relying on it.

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
  `scripts/update.mjs` auto-discarding a lockfile-only dirty tree before pulling. If
  `git pull`/`npm run update` ever blocks on this, `git checkout -- package-lock.json`
  first.
- **Feature-parity policy** (`CLAUDE.md`, repo root) — every client must expose the same
  features; a platform constraint is a reason to adapt the mechanism, not drop the
  feature; new features land on both clients in the same unit of work.
- **Prisma client generation on Windows** has a documented known issue/workaround — see
  `docs/development.md#known-issue-prisma-client-generation-on-windows` (not re-verified
  in this audit, just confirmed the section still exists).

## 7. Recent history highlights

No CHANGELOG.md — full history is `git log` (currently 29 commits, `c0b8dad` scaffold to
`9004c7d` most recent). Newest-first highlights from `git log --oneline -60`:

1. `9004c7d` Add mandatory pre-deploy database snapshot, per the global backup standard
2. `d69b080` Fix two real deploy bugs: incrementing ports on redeploy, and EAS non-interactive
3. `db897b0` Bring web client to full feature parity with the mobile app
4. `cb18a21` Fold mobile app builds into `npm run deploy`; add feature-parity policy
5. `5886a91` Deploy web on the same domain as the API, always, path-routed
6. `68e5fda` Wire web client into external-proxy compose + `npm run deploy`; fix EAS monorepo build
7. `60a57e0` Split web into its own thin client; extract shared logic; drop in-Expo web target
8. Earlier: initial scaffold, docs, dev-port auto-selection, rate tiers/overtime/CSV/email
   export, Caddy deployment, Manager/Timesheets/rounding features — see full `git log` for
   the rest.

**Working tree**: clean at time of this audit (`git status` — nothing staged or modified,
branch up to date with `origin/master`). One stray untracked file exists:
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
