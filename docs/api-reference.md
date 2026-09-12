# API Reference

Base URL is whatever `EXPO_PUBLIC_API_URL` points at on the client (default
`http://localhost:3001`, though the actual port on your machine depends on what
`npm run setup` picked — see [Automatic port selection](./development.md#automatic-port-selection)).
The examples below use `3001`; substitute your own. All request/response bodies are JSON.
Source: `server/src/routes/*.ts`, except [Deployment](#deployment) (`scripts/host-agent.mjs`,
a separate process — see that section for why).

## Authentication

Every endpoint except `/health`, `/auth/register`, and `/auth/login` requires:

```
Authorization: Bearer <token>
```

`<token>` is the JWT returned by register/login. It's an `HS256` JWT signed with
`JWT_SECRET`, payload `{ userId }`. Its lifetime depends on the `rememberMe` flag sent at
sign-in (`server/src/lib/auth.ts`): `true` (the default, and what both clients check by
default) produces a token with no `exp` claim at all — it never expires; `false` produces
a 1-day token. There is no refresh flow — a fresh sign-in via `/auth/login` is how a
client gets a new one. A missing or invalid/expired token gets a `401` with
`{ "error": "..." }` from the `requireAuth` preHandler, which runs on the whole `/sync/*`
route group.

Both `/auth/register` and `/auth/login` are rate-limited (10 requests / 15 minutes per
IP) and require a CAPTCHA answer, obtained from `GET /auth/captcha`:

```json
→ 200 { "id": "<uuid>", "question": "What is 4 + 7?" }
```

`id` is single-use — pass it back as `captchaId` with the numeric answer as
`captchaAnswer` on the very next register/login call. It's consumed (and must be
re-fetched) whether the answer was right or wrong, and it also expires 5 minutes after
being issued. This is a self-hosted, no-external-dependency check (no reCAPTCHA/Turnstile
account needed) meant to filter generic bots, not stop a targeted attacker —
`server/src/lib/captcha.ts` has the full rationale.

### `GET /health`

No auth. Liveness check.

```json
→ 200 { "ok": true }
```

### `POST /auth/register`

```json
{
  "email": "jane@example.com",
  "password": "at-least-8-chars",
  "captchaId": "<uuid from GET /auth/captcha>",
  "captchaAnswer": 11,
  "rememberMe": true
}
```

- `email` — must pass `zod`'s `.email()` check
- `password` — minimum 8 characters (no other complexity rule enforced)
- `captchaId` / `captchaAnswer` — from `GET /auth/captcha`; see [Authentication](#authentication)
- `rememberMe` — optional, defaults to `true`; controls the issued token's lifetime

```json
→ 201 { "token": "<jwt>", "userId": "<uuid>" }
→ 400 { "error": { "fieldErrors": {...}, "formErrors": [...] } }   // zod validation failure
→ 400 { "error": "Incorrect answer to the verification question — fetch a new one and try again." }
→ 409 { "error": "Email already registered" }
→ 429 { "error": "Rate limit exceeded, retry in ..." }
```

### `POST /auth/login`

Same body shape as register.

```json
→ 200 { "token": "<jwt>", "userId": "<uuid>" }
→ 400 { "error": {...} }          // validation failure (same shape as above)
→ 400 { "error": "Incorrect answer to the verification question — fetch a new one and try again." }
→ 401 { "error": "Invalid email or password" }
→ 429 { "error": "Rate limit exceeded, retry in ..." }
```

## Sync

Full protocol/design rationale: [`sync-protocol.md`](./sync-protocol.md). This section is
just the wire format. All fields below are required unless marked optional; `id` fields
are client-generated UUIDs (see [`data-model.md`](./data-model.md)).

### `POST /sync/push`

```jsonc
{
  "jobs": [
    { "id": "<uuid>", "name": "Coffee Shop", "colorHex": "#2563eb", "archived": false,
      "overtimeMultiplier": 1.5, "overtimeWeeklyThresholdHours": 40,
      "timesheetPeriodType": "biweekly", "timesheetWeekStartDay": 1,
      "timesheetBiweeklyAnchor": "2026-01-05T00:00:00.000Z", "timesheetMonthlyStartDay": 1,
      "timesheetFormat": "both", "timesheetIncludeEarnings": true, "timesheetIncludeNotes": true,
      "timesheetIncludeTimes": true, "roundingEnabled": true, "roundingMode": "nearest",
      "roundingIncrementMinutes": 15 }
      // every field except id/name/colorHex is optional — omitted fields keep their
      // current value on update, or the column's default on create
  ],
  "rateTiers": [
    { "id": "<uuid>", "jobId": "<uuid>", "name": "Standard",
      "isDefault": true, "archived": false }   // isDefault/archived optional
  ],
  "rateVersions": [
    { "id": "<uuid>", "tierId": "<uuid>", "hourlyRateCents": 1800,
      "effectiveFrom": "2026-09-01T00:00:00.000Z" }
  ],
  "shifts": [
    { "id": "<uuid>", "jobId": "<uuid>", "rateTierId": null, "clockIn": "2026-09-07T13:00:00.000Z",
      "clockOut": "2026-09-07T17:30:00.000Z", "notes": null }
      // rateTierId/clockOut/notes optional — rateTierId omitted or null means "the job's default tier"
  ],
  "breaks": [
    { "id": "<uuid>", "shiftId": "<uuid>", "start": "2026-09-07T15:00:00.000Z",
      "end": "2026-09-07T15:15:00.000Z" }   // end optional
  ],
  "managers": [
    { "id": "<uuid>", "name": "Jane Manager", "email": "jane@example.com", "archived": false }
      // archived optional
  ],
  "jobManagers": [
    { "id": "<uuid>", "jobId": "<uuid>", "managerId": "<uuid>" }
      // assigns this manager as a submission recipient for this job's timesheets
  ],
  "deletedJobIds": ["<uuid>"],
  "deletedRateTierIds": ["<uuid>"],
  "deletedRateVersionIds": ["<uuid>"],
  "deletedShiftIds": ["<uuid>"],
  "deletedBreakIds": ["<uuid>"],
  "deletedManagerIds": ["<uuid>"],
  "deletedJobManagerIds": ["<uuid>"]
}
```

Every array is optional and defaults to `[]` — send only what changed. Dates are
ISO-8601 strings (`zod`'s `.datetime()`, which requires the `Z`/offset suffix).

This endpoint **upserts by id** (create if the id doesn't already belong to this user,
otherwise update) and never trusts a client-supplied `updatedAt`/`deletedAt` — the server
sets `updatedAt` itself on every write, and the `deleted*Ids` arrays are the only way
to soft-delete a row (setting its `deletedAt`). A reference that doesn't resolve to a row
owned by the caller (a job's tier, a tier's job, a shift's job or tier, a break's shift, a
job-manager assignment's job or manager) is silently dropped rather than erroring (see
[ownership checks](./sync-protocol.md#ownership-checks)) — a push is never rejected
outright for one bad reference among many valid ones. The upsert arrays are also
**applied in the order shown above** (`managers` has no parent so its position relative to
jobs doesn't matter, but `jobManagers` depends on both a job and a manager and so is
pushed last) — see [why ordering matters](./sync-protocol.md#push) in the sync protocol
doc.

```json
→ 200 { "serverTimestamp": "2026-09-07T23:52:47.097Z" }
→ 400 { "error": {...} }   // zod validation failure — malformed shape, not a business-rule error
→ 401 { "error": "..." }   // missing/invalid token
```

`serverTimestamp` is informational only for this endpoint (the client doesn't need it —
the *next pull's* `serverTimestamp` is what becomes the new cursor).

### `GET /sync/pull`

```
GET /sync/pull?since=2026-09-07T20:00:00.000Z
GET /sync/pull                                    (first sync — omit `since` entirely)
```

`since` is optional; when omitted the server treats it as the beginning of time (returns
every row the user owns). When present it must be an ISO-8601 datetime string.

```json
→ 200 {
  "serverTimestamp": "2026-09-07T23:52:47.366Z",
  "jobs":         [ { "id": "...", "userId": "...", "name": "...", "colorHex": "...",
                      "archived": false, "overtimeMultiplier": null, "overtimeWeeklyThresholdHours": null,
                      "timesheetPeriodType": "weekly", "timesheetWeekStartDay": 1,
                      "timesheetBiweeklyAnchor": "...", "timesheetMonthlyStartDay": 1,
                      "timesheetFormat": "both", "timesheetIncludeEarnings": true,
                      "timesheetIncludeNotes": true, "timesheetIncludeTimes": true,
                      "roundingEnabled": false, "roundingMode": "nearest", "roundingIncrementMinutes": 15,
                      "createdAt": "...", "updatedAt": "...", "deletedAt": null } ],
  "rateTiers":    [ { "id": "...", "jobId": "...", "name": "Standard", "isDefault": true, "archived": false,
                      "createdAt": "...", "updatedAt": "...", "deletedAt": null } ],
  "rateVersions": [ { "id": "...", "tierId": "...", "hourlyRateCents": 1800, "effectiveFrom": "...",
                      "createdAt": "...", "updatedAt": "...", "deletedAt": null } ],
  "shifts":       [ { "id": "...", "userId": "...", "jobId": "...", "rateTierId": null, "clockIn": "...",
                      "clockOut": null, "notes": null,
                      "createdAt": "...", "updatedAt": "...", "deletedAt": null } ],
  "breaks":       [ { "id": "...", "shiftId": "...", "start": "...", "end": null,
                      "createdAt": "...", "updatedAt": "...", "deletedAt": null } ],
  "managers":     [ { "id": "...", "userId": "...", "name": "Jane Manager", "email": "jane@example.com",
                      "archived": false, "createdAt": "...", "updatedAt": "...", "deletedAt": null } ],
  "jobManagers":  [ { "id": "...", "jobId": "...", "managerId": "...",
                      "createdAt": "...", "updatedAt": "...", "deletedAt": null } ]
}
→ 400 { "error": {...} }   // malformed `since`
→ 401 { "error": "..." }
```

Returns **every** row with `updatedAt > since`, including soft-deleted ones (`deletedAt`
non-null) — the client is expected to apply those as local tombstones, not skip them.
Save `serverTimestamp` as the new cursor for the next call's `since`.

## Deployment

Not served by `server/` at all — routed to a separate host process
(`scripts/host-agent.mjs`) under the same domain. Full rationale:
[`deployment.md#the-host-agent`](./deployment.md#the-host-agent).

### `POST /update`

Requires `Authorization: Bearer <token>` — same JWT as every other authenticated
endpoint, verified with the same `JWT_SECRET`, no separate secret involved. Body: none.

```json
→ 202 { "started": true }
→ 401 { "error": "Missing or invalid bearer token" }
→ 409 { "error": "An update is already running" }
→ 409 { "error": "Server's working tree has uncommitted changes — resolve manually before updating." }
```

### `GET /update/status`

Same auth. Poll this after a `202` from `POST /update` until `running` is `false`.

```json
→ 200 {
  "running": false,
  "startedAt": "2026-09-11T18:00:00.000Z",
  "finishedAt": "2026-09-11T18:01:42.000Z",
  "exitCode": 0,
  "log": "[updater] Starting: ...\n...\n[updater] Finished with exit code 0"
}
```

`log` is a capped tail (last 500 lines) of the triggered command's combined
stdout/stderr, reset at the start of each run.

All endpoints below require the same `Authorization: Bearer <token>`. Full rationale and
setup: [`deployment.md#backups-borgbackup`](./deployment.md#backups-borgbackup).

### `GET /backup/config`

```json
→ 200 {
  "repoUrl": "/mnt/backups/clocker",
  "passphraseSet": true,
  "retentionCount": 14,
  "schedule": { "frequency": "daily", "hour": 3, "minute": 0, "weekday": null, "dayOfMonth": null },
  "sshPublicKey": "ssh-ed25519 AAAA... clocker-backup",
  "sshPublicKeyError": null
}
```

`passphraseSet` is the only signal about the passphrase — it's never returned.
`sshPublicKey` is generated once (via `ssh-keygen`, on the host, not in any container) on
first use and reused forever after. If that generation ever failed (most commonly:
`ssh-keygen`/OpenSSH's client tools aren't installed on the host), `sshPublicKey` stays
`null` and `sshPublicKeyError` explains why — every call to this endpoint (and to `PATCH`
below) retries generation first, so fixing the host (e.g. installing OpenSSH) resolves it
on the next request with no restart needed.

### `PATCH /backup/config`

Every field optional; only what's sent is changed.

```json
{
  "repoUrl": "/mnt/backups/clocker",
  "passphrase": "correct horse battery staple",   // "" clears it
  "retentionCount": 14,                             // null = never auto-prune
  "schedule": { "frequency": "daily", "hour": 3, "minute": 0 }   // null = off
}
```

```json
→ 200 <same shape as GET /backup/config>
```

### `POST /backup/run`

Body: none.

```json
→ 202 { "started": true }
→ 400 { "error": "Backup repo/passphrase aren't configured yet — set them in Settings first." }
→ 409 { "error": "Another operation is already running" }
```

### `GET /backup/status`

Poll after a `202` from `POST /backup/run` or `POST /backup/restore` until `running` is `false`.

```json
→ 200 {
  "running": false,
  "kind": "backup",
  "archiveName": "clocker-2026-09-11T18-59-01-483Z",
  "startedAt": "2026-09-11T18:59:01.483Z",
  "finishedAt": "2026-09-11T18:59:02.035Z",
  "exitCode": 0,
  "log": "[backup] Staging database dump and secrets...\n..."
}
```

### `GET /backup/runs`

Recent run history (most recent first, capped at 50), independent of `borg list` — this is
for at-a-glance troubleshooting, not the source of truth for what's restorable.

```json
→ 200 { "runs": [ { "kind": "backup", "status": "success", "archiveName": "clocker-...",
                     "message": "Archive clocker-... created",
                     "startedAt": "...", "finishedAt": "..." } ] }
```

### `GET /backup/archives`

Runs `borg list --json` against the configured repo — the actual source of truth for
what's restorable.

```json
→ 200 { "archives": [ { "name": "clocker-2026-09-11T18-59-01-483Z", "time": "..." } ] }
→ 400 { "error": "..." }   // repo/passphrase not configured, or borg itself failed
```

### `POST /backup/restore`

```json
{ "archiveName": "clocker-2026-09-11T18-59-01-483Z", "restoreDb": true, "restoreEnv": false }
```

At least one of `restoreDb`/`restoreEnv` is required. Takes its own pre-restore safety
snapshot before touching anything — see the deployment doc.

```json
→ 202 { "started": true }
→ 400 { "error": "archiveName is required" }
→ 400 { "error": "Choose at least one of restoreDb/restoreEnv" }
→ 409 { "error": "Another operation is already running" }
```

### `POST /backup/disaster-recovery/archives`

Same as `GET /backup/archives`, but lists an ad-hoc repo/passphrase given in the body
instead of the saved config — for recovering onto a fresh install, or one whose own saved
backup config was itself lost. Never reads or touches `.backup-config.json`.

```json
{ "repoUrl": "clocker-backup@10.1.30.64:/srv/clocker-backup/repositories/clocker", "passphrase": "..." }
```

```json
→ 200 { "archives": [ ... ] }
→ 400 { "error": "repoUrl and passphrase are required" }
→ 400 { "error": "..." }   // borg itself failed (bad repo/passphrase/host unreachable)
```

### `POST /backup/disaster-recovery/restore`

Same as `POST /backup/restore`, but restores from an ad-hoc repo/passphrase given in the
body instead of the saved config.

```json
{ "repoUrl": "...", "passphrase": "...", "archiveName": "clocker-2026-09-11T18-59-01-483Z", "restoreDb": true, "restoreEnv": false }
```

```json
→ 202 { "started": true }
→ 400 { "error": "repoUrl and passphrase are required" }
→ 400 { "error": "archiveName is required" }
→ 400 { "error": "Choose at least one of restoreDb/restoreEnv" }
→ 409 { "error": "Another operation is already running" }
```

## Manual smoke test

The exact sequence used to verify this API end-to-end during development (adjust the port
to match `PORT` in your own `server/.env`):

```bash
# fetch a captcha, answer it, then register and capture the token
curl -s http://localhost:3001/auth/captcha
# → { "id": "<uuid>", "question": "What is 4 + 7?" }

curl -s -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"password123","captchaId":"<uuid>","captchaAnswer":11}'

TOKEN="<paste the token from above>"

# push a job, its default rate tier, and that tier's rate
curl -s -X POST http://localhost:3001/sync/push \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"jobs":[{"id":"11111111-1111-1111-1111-111111111111","name":"Coffee Shop","colorHex":"#2563eb","archived":false}],"rateTiers":[{"id":"22222222-2222-2222-2222-222222222222","jobId":"11111111-1111-1111-1111-111111111111","name":"Standard","isDefault":true}],"rateVersions":[{"id":"33333333-3333-3333-3333-333333333333","tierId":"22222222-2222-2222-2222-222222222222","hourlyRateCents":1800,"effectiveFrom":"2026-09-01T00:00:00.000Z"}],"shifts":[],"breaks":[],"deletedJobIds":[],"deletedRateTierIds":[],"deletedRateVersionIds":[],"deletedShiftIds":[],"deletedBreakIds":[]}'

# pull everything back
curl -s http://localhost:3001/sync/pull -H "Authorization: Bearer $TOKEN"

# confirm auth is actually enforced
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/sync/pull   # expect 401
```
