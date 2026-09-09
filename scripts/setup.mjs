#!/usr/bin/env node
// One-shot bootstrap for a fresh clone: installs dependencies, picks free ports for
// Postgres and the API (never assumes 5433/3001 are actually free on this machine),
// creates server/.env with a generated secret, starts Postgres via Docker, and applies
// migrations. Safe to re-run — every step is skipped or made a no-op if it's already done.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandExists, findFreePort, run, section, step, warn } from "./lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const serverDir = join(rootDir, "server");
const rootEnvPath = join(rootDir, ".env");
const serverEnvPath = join(serverDir, ".env");

function readEnvValue(filePath, key) {
  if (!existsSync(filePath)) return null;
  const match = readFileSync(filePath, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim().replace(/^"|"$/g, "") : null;
}

section("Installing dependencies");
run("npm install", { cwd: rootDir });

section("Configuring ports & server/.env");
let postgresPort;
let apiPort;

if (existsSync(serverEnvPath)) {
  step("server/.env already exists, leaving it as-is");
  const databaseUrl = readEnvValue(serverEnvPath, "DATABASE_URL") ?? "";
  // Trust whatever's already configured over re-scanning — this server/.env may have
  // been hand-edited to point at a Postgres this script never chose in the first place.
  postgresPort = databaseUrl.match(/localhost:(\d+)/)?.[1] ?? readEnvValue(rootEnvPath, "POSTGRES_PORT") ?? "5433";
  apiPort = readEnvValue(serverEnvPath, "PORT") ?? "3001";
} else {
  // Fresh install: scan for ports nothing else on this machine is already using, rather
  // than assuming the conventional 5433/3001 are actually free.
  postgresPort = readEnvValue(rootEnvPath, "POSTGRES_PORT");
  if (postgresPort) {
    step(`Using existing Postgres port ${postgresPort} from .env`);
  } else {
    postgresPort = String(await findFreePort(5433));
    step(`Port 5433+ scanned — selected ${postgresPort} for Postgres`);
  }
  apiPort = String(await findFreePort(3001));
  step(`Port 3001+ scanned — selected ${apiPort} for the API`);

  const secret = randomBytes(48).toString("hex");
  const contents = [
    `DATABASE_URL="postgresql://clocker:clocker@localhost:${postgresPort}/clocker?schema=public"`,
    `JWT_SECRET="${secret}"`,
    `PORT=${apiPort}`,
    "",
  ].join("\n");
  writeFileSync(serverEnvPath, contents);
  step("Wrote server/.env with a generated JWT_SECRET");
}

// Docker Compose reads a root .env file (separate from server/.env) to fill in
// docker-compose.yml's `${POSTGRES_PORT}`. Keep it in sync with whatever Postgres port
// is actually in play above, whether freshly chosen or read from an existing server/.env,
// so the container's published port never silently drifts from what the API expects.
if (readEnvValue(rootEnvPath, "POSTGRES_PORT") !== postgresPort) {
  writeFileSync(rootEnvPath, `POSTGRES_PORT=${postgresPort}\n`);
  step(`Set POSTGRES_PORT=${postgresPort} in .env for Docker Compose`);
}

section("Starting Postgres");
let dbReady = false;
if (!commandExists("docker --version")) {
  warn("Docker isn't installed or isn't on PATH — skipping automatic Postgres startup.");
  warn("Install Docker Desktop, or point DATABASE_URL in server/.env at your own Postgres, then re-run this script.");
} else if (!run("docker compose up -d", { cwd: rootDir, optional: true })) {
  warn("`docker compose up -d` failed — see the error above.");
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
  npm run dev:server   # starts the API on http://localhost:${apiPort}
  npm run dev:app      # starts Expo — press i/a, or scan the QR code with Expo Go

The app needs EXPO_PUBLIC_API_URL pointed at the port above (it defaults to
http://localhost:3001, which only matches if that's what got picked on this machine):
  cd app && EXPO_PUBLIC_API_URL=http://localhost:${apiPort} npm run start

Android emulator: use http://10.0.2.2:${apiPort} instead of localhost. Physical device:
use your machine's LAN IP instead.
`);
