# Clocker-specific standards

Narrows/extends the global standards at `~/.claude/CLAUDE.md` for this project
specifically. That file governs anything not addressed here.

## Feature parity across clients

**Every client (`app/` mobile, `web/`, and any future client) must expose the same
features and functionality.** A feature isn't done when it ships on one platform — it's
done when it's available everywhere a user might reasonably work: clocking in/out,
breaks, job/rate-tier/overtime/rounding configuration, History, Export, Timesheets,
Managers, and anything added after this policy, on both `app/` and `web/` alike.

This is a policy about *scope*, not about internal architecture — it does not mean the
clients share an implementation. `app/` stays local-first (SQLite, an outbox, opportunistic
sync); `web/` stays a thin, server-dependent client with no local database (see
`docs/architecture.md`'s "Two frontend clients, one API"). That split is deliberate and
stays. What must NOT diverge is what a user can actually *do* on each platform.

Where a platform genuinely can't do the same thing the same way (e.g. `web/` has no
native OS share sheet or mail composer, no OTA-update concept), adapt to an equivalent
that serves the same end (a browser download + clipboard copy instead of a native share
sheet; nothing needed in place of OTA since a web page always serves the latest deploy) —
document the adaptation and why, in the relevant doc section, rather than silently
shipping a smaller feature set. A platform constraint is a reason to adapt the mechanism,
not a reason to drop the feature.

When adding a new feature going forward: build it for both clients as part of the same
unit of work (same PR/commit series), not "mobile now, web later." If a genuine reason
prevents landing both at once, say so explicitly and track the gap — don't let it become
implicit permanent scope.
