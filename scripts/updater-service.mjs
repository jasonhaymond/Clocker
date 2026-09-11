#!/usr/bin/env node
// A tiny, long-lived process that lets the app trigger a production update ("Update
// Server" button in Settings) — `git pull` + `npm run deploy` — without giving the main
// server container access to the Docker socket or the host repo. Deliberately NOT a
// Docker container: it runs directly on the deploy host (started via pm2/systemd, see
// docs/deployment.md#triggering-an-update-from-the-app) so it keeps running and can
// report status even while the deploy it triggered restarts every container, including
// the API server itself.
//
// Reachable through the same domain as the API via a `/update*` Caddy route (either the
// bundled Caddyfile, using host.docker.internal, or your own external proxy) — see
// scripts/deploy.mjs for how UPDATER_PORT/UPDATER_BIND get chosen and wired up.
//
// Auth deliberately reuses JWT_SECRET from .env.prod rather than a separate secret: this
// is a personal single-user app, so any device already signed in can trigger an update,
// the same way it can already read/write all of that user's data via /sync/*.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import { captureOutput, readEnvValue } from "./lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const envProdPath = join(rootDir, ".env.prod");

const jwtSecret = readEnvValue(envProdPath, "JWT_SECRET");
if (!jwtSecret) {
  console.error("JWT_SECRET not found in .env.prod — run `npm run deploy` at least once first.");
  process.exit(1);
}

const port = Number(readEnvValue(envProdPath, "UPDATER_PORT") ?? 4001);
const bind = readEnvValue(envProdPath, "UPDATER_BIND") ?? "0.0.0.0";

// Capped so a long history of updates (or a chatty deploy) can't grow this unbounded —
// this is a status tail for the in-progress/most recent run, not a permanent log.
const MAX_LOG_LINES = 500;
const state = { running: false, startedAt: null, finishedAt: null, exitCode: null, log: [] };

function appendLog(chunk) {
  const lines = chunk.toString().split("\n").filter(Boolean);
  state.log.push(...lines);
  if (state.log.length > MAX_LOG_LINES) state.log.splice(0, state.log.length - MAX_LOG_LINES);
}

function startUpdate() {
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.exitCode = null;
  state.log = [];
  const command = "git pull --ff-only && npm install && npm run deploy -- --skip-app";
  appendLog(`[updater] Starting: ${command}`);

  // --skip-app: a UI button tap shouldn't silently kick off a cloud EAS build every time
  // (build minutes, and the first-ever build needs an interactive prompt this headless
  // process can't answer) — a full mobile rebuild still goes through `npm run deploy` by
  // hand, or `npm run deploy:app` for a JS-only OTA update.
  const child = spawn("sh", ["-c", command], { cwd: rootDir });
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);
  child.on("close", (code) => {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    state.exitCode = code;
    appendLog(`[updater] Finished with exit code ${code}`);
  });
  child.on("error", (err) => {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    state.exitCode = -1;
    appendLog(`[updater] Failed to start: ${err.message}`);
  });
}

function verifyAuth(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  try {
    jwt.verify(header.slice("Bearer ".length), jwtSecret);
    return true;
  } catch {
    return false;
  }
}

const server = createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (!verifyAuth(req)) return send(401, { error: "Missing or invalid bearer token" });

  if (req.method === "POST" && req.url === "/update") {
    if (state.running) return send(409, { error: "An update is already running" });
    // Same "refuse over uncommitted changes" rule as scripts/update.mjs/deploy.mjs —
    // `git pull --ff-only` alone wouldn't reliably catch every case, and this fails fast
    // with a clear reason instead of an ambiguous mid-pull error.
    const dirty = captureOutput("git status --porcelain", { cwd: rootDir });
    if (dirty) {
      return send(409, { error: "Server's working tree has uncommitted changes — resolve manually before updating." });
    }
    startUpdate();
    return send(202, { started: true });
  }

  if (req.method === "GET" && req.url === "/update/status") {
    return send(200, {
      running: state.running,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      exitCode: state.exitCode,
      log: state.log.join("\n"),
    });
  }

  send(404, { error: "Not found" });
});

server.listen(port, bind, () => {
  console.log(`Clocker updater listening on ${bind}:${port}`);
});
