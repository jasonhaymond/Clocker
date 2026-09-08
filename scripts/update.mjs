#!/usr/bin/env node
// Pulls the latest changes, reinstalls dependencies, and applies any new database
// migrations. Never force-pushes or discards local work — if the working tree is dirty
// or history has diverged, it stops and tells you what to do instead of guessing.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureOutput, commandExists, run, section, step, warn } from "./lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

section("Pulling latest changes");
if (!commandExists("git --version") || !existsSync(join(rootDir, ".git"))) {
  warn("Not a git checkout (or git isn't installed) — skipping pull.");
} else {
  const dirty = captureOutput("git status --porcelain", { cwd: rootDir });
  if (dirty) {
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
} else {
  run("npm run db:deploy --workspace=server", { cwd: rootDir });
  if (!run("npm run db:generate --workspace=server", { cwd: rootDir, optional: true })) {
    warn("Prisma client generation failed (often a stale lock from another running process) — re-run `npm run db:generate --workspace=server` if types look out of date.");
  }
}

section("Done");
console.log("Restart `npm run dev:server` / `npm run dev:app` to pick up the changes.");
