# Clocker Documentation

- **[Architecture](./architecture.md)** — monorepo layout, the local-first design
  principle, and why the app is built the way it is (client-generated UUIDs, the outbox
  pattern, last-write-wins, a custom server instead of a BaaS).
- **[Data Model](./data-model.md)** — every table/field on both the Postgres (server) and
  SQLite (client) sides, and how they map to each other.
- **[Sync Protocol](./sync-protocol.md)** — exactly how push/pull works: the outbox,
  conflict resolution, ownership checks, and what the protocol deliberately doesn't do.
- **[API Reference](./api-reference.md)** — every HTTP endpoint, request/response shapes,
  status codes, and a copy-pasteable curl smoke test.
- **[Development Guide](./development.md)** — setup/update scripts, environment
  variables, day-to-day commands, and known issues (with workarounds already applied) you
  might otherwise lose time to.
- **[Deployment](./deployment.md)** — what's needed before this leaves `localhost`:
  required env vars, security gaps to close first, and mobile app distribution options.

Start with the root [`README.md`](../README.md) for the quick-start; come here for the
"why" and the "exactly how" behind it.
