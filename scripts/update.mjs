#!/usr/bin/env node
// Pulls the latest changes, reinstalls dependencies, and applies any new database
// migrations. Never force-pushes or discards local work — if the working tree is dirty
// or history has diverged, it stops and tells you what to do instead of guessing.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureOutput, commandExists, discardSafeLockfileDrift, run, section, step, warn } from "./lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

section("Pulling latest changes");
if (!commandExists("git --version") || !existsSync(join(rootDir, ".git"))) {
  warn("Not a git checkout (or git isn't installed) — skipping pull.");
} else {
  // See discardSafeLockfileDrift's own comment for the exact rule: a locally modified
  // package-lock.json is discarded outright (npm install regenerates it a few lines down
  // regardless) unless package.json is ALSO dirty, in which case that pairing is left
  // alone as a real uncommitted change. Anything else dirty still aborts the pull below.
  const { discarded, remaining } = discardSafeLockfileDrift(rootDir);
  if (discarded) {
    step("package-lock.json was locally modified (npm install regenerates it below anyway) — discarded it before pulling.");
  }

  if (remaining.length > 0) {
    warn("Working tree has uncommitted changes — skipping pull so nothing gets overwritten.");
    warn("Commit or stash your changes, then re-run this script.");
  } else {
    const before = captureOutput("git rev-parse HEAD", { cwd: rootDir });
    if (run("git pull --ff-only", { cwd: rootDir, optional: true })) {
      const after = captureOutput("git rev-parse HEAD", { cwd: rootDir });
      if (before && after && before !== after) {
        step("New commits:");
        run(`git log --oneline ${before}..${after}`, { cwd: rootDir, optional: true });
      } else {
        step("Already up to date.");
      }
    } else {
      warn("`git pull --ff-only` failed — your branch has probably diverged from its remote.");
      warn("Resolve that manually (e.g. `git pull` or `git rebase`), then re-run this script.");
    }
  }
}

section("Installing dependencies");
run("npm install", { cwd: rootDir });

section("Applying database migrations");
if (!existsSync(join(rootDir, "server", ".env"))) {
  warn("server/.env doesn't exist yet — run `npm run setup` first.");
} else if (!run("npm run db:deploy --workspace=server", { cwd: rootDir, optional: true })) {
  // Non-fatal: this machine might only be running the app (e.g. against a deployed
  // server) with no reason to have the local dev Postgres up right now — don't block
  // `npm install` / the rest of the update over a database this run may not even need.
  warn("Couldn't apply migrations — is the local dev Postgres running? (`docker compose up -d`)");
  warn("Harmless if you're not using the local dev server right now; otherwise start Postgres and re-run this.");
} else if (!run("npm run db:generate --workspace=server", { cwd: rootDir, optional: true })) {
  warn("Prisma client generation failed (often a stale lock from another running process) — re-run `npm run db:generate --workspace=server` if types look out of date.");
}

section("Done");
console.log("Restart `npm run dev:server` / `npm run dev:app` to pick up the changes.");
