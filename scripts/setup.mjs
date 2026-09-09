#!/usr/bin/env node
// One-shot bootstrap for a fresh clone: installs dependencies, picks free ports for
// Postgres and the API (never assumes 5433/3001 are actually free on this machine, and
// re-checks even on an already-configured install in case something else has since
// claimed the port), creates/updates server/.env, starts Postgres via Docker, and
// applies migrations. Safe to re-run — every step is skipped or made a no-op if it's
// already done.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureOutput, commandExists, findFreePort, isPortFree, readEnvValue, run, section, step, upsertEnvLine, warn } from "./lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const serverDir = join(rootDir, "server");
const rootEnvPath = join(rootDir, ".env");
const serverEnvPath = join(serverDir, ".env");

section("Installing dependencies");
run("npm install", { cwd: rootDir });

section("Configuring ports & server/.env");
const serverEnvExistedBefore = existsSync(serverEnvPath);

// If our own Postgres container is already running, it's expected to be holding its
// configured port — that's not a conflict, it's the whole point. Only treat the
// configured port as suspect when nothing of ours currently explains it being occupied.
function isOwnPostgresRunning() {
  if (!commandExists("docker --version")) return false;
  const services = captureOutput("docker compose ps --status running --services", { cwd: rootDir });
  return services?.split("\n").includes("postgres") ?? false;
}

async function resolvePort(current, { startPort, label, skipLiveCheck = false }) {
  if (current && (skipLiveCheck || (await isPortFree(Number(current))))) {
    step(`Using existing ${label} port ${current}`);
    return current;
  }
  if (current) warn(`Configured ${label} port ${current} is now in use by something else on this machine — picking a new one.`);
  const chosen = String(await findFreePort(startPort));
  step(`Port ${startPort}+ scanned — selected ${chosen} for ${label}`);
  return chosen;
}

let postgresPort = readEnvValue(rootEnvPath, "POSTGRES_PORT") ?? readEnvValue(serverEnvPath, "DATABASE_URL")?.match(/localhost:(\d+)/)?.[1];
postgresPort = await resolvePort(postgresPort, { startPort: 5433, label: "Postgres", skipLiveCheck: isOwnPostgresRunning() });
upsertEnvLine(rootEnvPath, "POSTGRES_PORT", postgresPort);

let apiPort = readEnvValue(serverEnvPath, "PORT");
apiPort = await resolvePort(apiPort, { startPort: 3001, label: "API" });

let jwtSecret = readEnvValue(serverEnvPath, "JWT_SECRET");
if (!jwtSecret) jwtSecret = randomBytes(48).toString("hex");

upsertEnvLine(serverEnvPath, "DATABASE_URL", `"postgresql://clocker:clocker@localhost:${postgresPort}/clocker?schema=public"`);
upsertEnvLine(serverEnvPath, "JWT_SECRET", `"${jwtSecret}"`);
upsertEnvLine(serverEnvPath, "PORT", apiPort);
step(serverEnvExistedBefore ? "Updated server/.env" : "Wrote server/.env with a generated JWT_SECRET");

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

To pin a specific port instead of whatever gets auto-picked, see "Changing a port" in
docs/development.md.
`);
