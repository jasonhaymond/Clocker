# Clocker Documentation

Start here to find the right guide — pick whichever describes you.

## "I just want to use Clocker"

**[User Guide](./user-guide.md)** — everything about actually using the app: clocking in
and out, jobs, timesheets, exporting hours, and settings. No technical background needed.

## "I want to run my own Clocker server"

**[Deployment](./deployment.md)** — a complete, step-by-step walkthrough for putting
Clocker on a real server with your own domain name, written to be followable even if
you've never done this kind of thing before (it explains the unfamiliar terms as it goes —
Docker, reverse proxies, SSH, and so on). Covers both the easy path (Clocker manages
everything, including HTTPS, for you) and running behind a reverse proxy you already have,
plus backups, updates, and troubleshooting.

## "I want to write code for Clocker"

- **[Development Guide](./development.md)** — get a working copy running on your own
  computer: setup, day-to-day commands, environment variables, and known quirks with
  ready-made fixes so you don't lose time to them.
- **[Architecture](./architecture.md)** — how the app is actually put together and why:
  the pieces, how they talk to each other, and the reasoning behind the less obvious
  decisions (why there are two separate apps instead of one, why it works offline, why
  pay rates are never just a single number, and so on). Start here if you want the "why"
  before diving into code.
- **[Data Model](./data-model.md)** — every piece of information Clocker stores, on both
  the phone app's and the server's database, and how they line up with each other.
- **[Sync Protocol](./sync-protocol.md)** — exactly how a phone and the server agree on
  what's changed, including what happens when the same thing is edited on two devices
  before either has a chance to sync.
- **[API Reference](./api-reference.md)** — every request the app can make to the server,
  with real examples and a copy-pasteable test sequence.
- **[Import Format](./import-format.md)** — the exact spreadsheet layout Clocker expects
  when importing from the Hours Tracker app.

## Still not sure?

The root [`README.md`](../README.md) is the front door — a short overview of what Clocker
is and a quick-start for developers. Come back here for anything more detailed.
