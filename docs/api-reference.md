# API Reference

Base URL is whatever `EXPO_PUBLIC_API_URL` points at on the client (default
`http://localhost:3001`, though the actual port on your machine depends on what
`npm run setup` picked — see [Automatic port selection](./development.md#automatic-port-selection)).
The examples below use `3001`; substitute your own. All request/response bodies are JSON.
Source: `server/src/routes/*.ts`.

## Authentication

Every endpoint except `/health`, `/auth/register`, and `/auth/login` requires:

```
Authorization: Bearer <token>
```

`<token>` is the JWT returned by register/login. It's an `HS256` JWT signed with
`JWT_SECRET`, payload `{ userId }`, expiring after **180 days** (`server/src/lib/auth.ts`).
There is no refresh flow — a fresh sign-in via `/auth/login` is how a client gets a new
one. A missing or invalid/expired token gets a `401` with `{ "error": "..." }` from the
`requireAuth` preHandler, which runs on the whole `/sync/*` route group.

### `GET /health`

No auth. Liveness check.

```json
→ 200 { "ok": true }
```

### `POST /auth/register`

```json
{ "email": "jane@example.com", "password": "at-least-8-chars" }
```

- `email` — must pass `zod`'s `.email()` check
- `password` — minimum 8 characters (no other complexity rule enforced)

```json
→ 201 { "token": "<jwt>", "userId": "<uuid>" }
→ 400 { "error": { "fieldErrors": {...}, "formErrors": [...] } }   // zod validation failure
→ 409 { "error": "Email already registered" }
```

### `POST /auth/login`

Same body shape as register.

```json
→ 200 { "token": "<jwt>", "userId": "<uuid>" }
→ 400 { "error": {...} }          // validation failure (same shape as above)
→ 401 { "error": "Invalid email or password" }
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
      "overtimeMultiplier": 1.5, "overtimeWeeklyThresholdHours": 40 }
      // archived/overtimeMultiplier/overtimeWeeklyThresholdHours all optional
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
  "deletedJobIds": ["<uuid>"],
  "deletedRateTierIds": ["<uuid>"],
  "deletedRateVersionIds": ["<uuid>"],
  "deletedShiftIds": ["<uuid>"],
  "deletedBreakIds": ["<uuid>"],
  "deletedManagerIds": ["<uuid>"]
}
```

Every array is optional and defaults to `[]` — send only what changed. Dates are
ISO-8601 strings (`zod`'s `.datetime()`, which requires the `Z`/offset suffix).

This endpoint **upserts by id** (create if the id doesn't already belong to this user,
otherwise update) and never trusts a client-supplied `updatedAt`/`deletedAt` — the server
sets `updatedAt` itself on every write, and the `deleted*Ids` arrays are the only way
to soft-delete a row (setting its `deletedAt`). A reference that doesn't resolve to a row
owned by the caller (a job's tier, a tier's job, a shift's job or tier, a break's shift) is
silently dropped rather than erroring (see
[ownership checks](./sync-protocol.md#ownership-checks)) — a push is never rejected
outright for one bad reference among many valid ones. The upsert arrays are also
**applied in the order shown above** (`managers` has no parent, so its position doesn't
matter) — see [why ordering matters](./sync-protocol.md#push) in the sync protocol doc.

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
                      "archived": false, "createdAt": "...", "updatedAt": "...", "deletedAt": null } ]
}
→ 400 { "error": {...} }   // malformed `since`
→ 401 { "error": "..." }
```

Returns **every** row with `updatedAt > since`, including soft-deleted ones (`deletedAt`
non-null) — the client is expected to apply those as local tombstones, not skip them.
Save `serverTimestamp` as the new cursor for the next call's `since`.

## Manual smoke test

The exact sequence used to verify this API end-to-end during development (adjust the port
to match `PORT` in your own `server/.env`):

```bash
# register and capture the token
curl -s -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"password123"}'

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
