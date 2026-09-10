# Clocker Documentation

- **[Architecture](./architecture.md)** — monorepo layout, why there are two separate
  frontend clients (mobile local-first vs. web thin-client) sharing one API instead of one
  universal codebase, the local-first design principle, and why the app is built the way
  it is (client-generated UUIDs, the outbox pattern, last-write-wins, a custom server
  instead of a BaaS).
- **[Data Model](./data-model.md)** — every table/field on both the Postgres (server) and
  SQLite (client) sides, and how they map to each other.
- **[Sync Protocol](./sync-protocol.md)** — exactly how push/pull works: the outbox,
  conflict resolution, ownership checks, and what the protocol deliberately doesn't do.
- **[API Reference](./api-reference.md)** — every HTTP endpoint, request/response shapes,
  status codes, and a copy-pasteable curl smoke test.
- **[Development Guide](./development.md)** — setup/update scripts, environment
  variables, day-to-day commands, and known issues (with workarounds already applied) you
  might otherwise lose time to.
- **[Deployment](./deployment.md)** — a complete, step-by-step walkthrough for a real
  production deployment (Caddy + Docker Compose, with automatic HTTPS, or behind your own
  existing reverse proxy), how it differs from the local dev stack, troubleshooting,
  required env vars, deploying the web client alongside the API, and building/installing
  the Expo app itself (EAS Build, internal distribution, OTA updates).

Start with the root [`README.md`](../README.md) for the quick-start; come here for the
"why" and the "exactly how" behind it.
