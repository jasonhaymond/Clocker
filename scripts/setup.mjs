#!/usr/bin/env node
// One-shot bootstrap for a fresh clone: installs dependencies, creates server/.env with a
// generated secret, starts Postgres via Docker, and applies migrations. Safe to re-run —
// every step is skipped or made a no-op if it's already done.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandExists, run, section, step, warn } from "./lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const serverDir = join(rootDir, "server");
const envPath = join(serverDir, ".env");
const envExamplePath = join(serverDir, ".env.example");

section("Installing dependencies");
run("npm install", { cwd: rootDir });

section("Configuring server/.env");
if (existsSync(envPath)) {
  step("server/.env already exists, leaving it as-is");
} else {
  let contents = readFileSync(envExamplePath, "utf8");
  const secret = randomBytes(48).toString("hex");
  contents = contents.replace(/JWT_SECRET=".*"/, `JWT_SECRET="${secret}"`);
  writeFileSync(envPath, contents);
  step("Created server/.env with a generated JWT_SECRET");
}

section("Starting Postgres");
let dbReady = false;
if (!commandExists("docker --version")) {
  warn("Docker isn't installed or isn't on PATH — skipping automatic Postgres startup.");
  warn("Install Docker Desktop, or point DATABASE_URL in server/.env at your own Postgres, then re-run this script.");
} else if (!run("docker compose up -d", { cwd: rootDir, optional: true })) {
  warn("`docker compose up -d` failed — see the error above (a port conflict is the usual cause).");
} else {
  step("Waiting for Postgres to accept connections...");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (run("docker compose exec -T postgres pg_isready -U clocker -d clocker", { cwd: rootDir, optional: true })) {
      dbReady = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!dbReady) warn("Postgres didn't report ready in time — migrations below may fail; try `docker compose logs postgres`.");
}

if (dbReady) {
  section("Applying database migrations");
  run("npm run db:deploy --workspace=server", { cwd: rootDir });
  if (!run("npm run db:generate --workspace=server", { cwd: rootDir, optional: true })) {
    warn("Prisma client generation failed (often a stale lock from another running process) — re-run `npm run db:generate --workspace=server` if types look out of date.");
  }
} else {
  warn("Skipping migrations since Postgres isn't confirmed ready. Run `npm run db:deploy --workspace=server` once it's up.");
}

section("Done");
console.log(`
Next steps:
  npm run dev:server   # starts the API on http://localhost:3001
  npm run dev:app      # starts Expo — press i/a, or scan the QR code with Expo Go

The app talks to the server via EXPO_PUBLIC_API_URL (defaults to http://localhost:3001).
Android emulator: use http://10.0.2.2:3001. Physical device: use your machine's LAN IP.
`);
