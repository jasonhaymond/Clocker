# Clocker — Status

_Last updated: 2026-09-11_

## Deployed

- **Production**: `https://clocker.haymondtechnologies.com`, on the `nextcloud` box,
  `PROXY_MODE=external` — Clocker's own containers (Postgres, server, web) run there via
  `docker-compose.prod.external-proxy.yml`, fronted by a separate, pre-existing Caddy
  instance on another machine (`10.1.30.45` is Clocker's host, as seen from that proxy).
  That external Caddy config path-routes `/health`, `/auth/*`, `/sync/*` to the server's
  published port and everything else to the web client's — get the exact current ports
  from `SERVER_PORT`/`WEB_PORT` in `.env.prod` on `nextcloud`, not from memory; they're
  stable across redeploys now (see Recent work) but were not always.
- **Mobile app**: not yet built as a real installable APK/IPA — `app/eas.json` exists
  with the monorepo fix (`EXPO_USE_METRO_WORKSPACE_ROOT=1`) and the deployed domain baked
  into `preview`/`production` profiles, but the EAS project itself may still need linking
  (`eas init`) on whichever machine runs the build next — this is an interactive,
  one-time step `npm run deploy` can prompt for but not complete unattended.

## Recent work (most recent first)

- Fixed a real production incident: the external proxy's config was pointing at a stale,
  no-longer-correct server port, causing every `/sync/*`/`/auth/*` call to 502 (web UI
  loaded fine since its own port was still correct) — this is why "Add Job" appeared to
  do nothing and Settings showed "Request failed (502)". Fixed by hand-correcting the
  proxy's port to match `.env.prod`'s actual `SERVER_PORT`.
- Added a global error banner to the web client (`web/src/App.tsx` + `store.tsx`'s
  `guarded()` wrapper) — every store action's failure is now visible above whichever tab
  is active, instead of silently rejecting with nothing shown (root cause of "Add Job
  does nothing" before the proxy fix above).
- Fixed a real port-drift bug in `scripts/deploy.mjs`: `SERVER_PORT`/`WEB_PORT` used to be
  re-verified as "free" on every redeploy, but that check can't distinguish "taken by
  something else" from "taken by this same stack's own already-running container" — so
  every redeploy incremented the port forever instead of settling. Now only scanned once
  (when unset); reused unconditionally after that.
- Fixed `npm run deploy`'s EAS build step passing `--non-interactive`, which turned
  first-time EAS project linking into a hard failure instead of an interactive prompt.
- Added a mandatory pre-deploy database snapshot (`pg_dump --clean --if-exists` to
  `backups/`, gitignored) — verified with a real create/truncate/restore cycle.
- Brought the web client (`web/`) to full feature parity with the mobile app — Jobs (rate
  tiers, overtime, rounding, timesheet settings, manager assignment), multi-job Clock
  with breaks and custom "At..." times, History, Export, Timesheets, Settings. See
  `CLAUDE.md`'s feature-parity policy, which this work established.
- Folded mobile app builds into `npm run deploy` itself (`--skip-app` to opt out for one
  run); OTA-only updates stay a separate, lighter `npm run deploy:app`.
- Split the monorepo into 4 workspaces (`shared/`, `app/`, `server/`, `web/`) — `web/` is
  a deliberately thin, server-dependent client (no local DB), unlike `app/`'s
  local-first/SQLite/outbox design. See `docs/architecture.md`.

## Known issues / not yet done

- Editing a shift's clock-in/clock-out time and breaks after the fact isn't built yet —
  tracked as the next piece of work (in progress as of this writing).
- Mobile app hasn't been built/installed successfully yet on the actual target device —
  next real build needs to get through EAS project linking (see Deployed, above) and then
  a real install-and-click-through pass.
- Web client's UI has not been manually clicked through in a real browser by a human
  since the parity rebuild — only verified via typecheck, production build, and replaying
  every mutation's exact payload against a real server. Do a real pass before trusting it
  fully for anything beyond what's already been used in production (Jobs, Settings).
- `PROXY_MODE=external`'s web deployment isn't wired into any *automatic* proxy-config
  update — the printed Caddy snippet from `npm run deploy` has to be hand-applied to the
  external proxy every time ports change, which is exactly what caused the 502 incident
  above. Worth revisiting if this recurs.
- No automated test suite (typecheck + manual verification only) — a deliberate,
  documented choice for this project's current size, per `docs/development.md`.
