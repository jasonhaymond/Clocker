#!/usr/bin/env node
// A tiny, long-lived process that gives the app two capabilities the main server (running
// inside Docker, deliberately with no host/Docker-socket access) can't have on its own:
// triggering a production update ("Update Server" in Settings — git pull + npm run
// deploy), and taking/restoring an encrypted, deduplicated BorgBackup (needs `docker
// compose exec` to reach Postgres, plus the host's own .env.prod for the secrets half of
// a backup). Deliberately NOT a Docker container: runs directly on the deploy host
// (started via pm2/systemd, see docs/deployment.md#the-host-agent) so it keeps running —
// and can report status — even while an update it triggers restarts every container,
// including the API server itself.
//
// Reachable through the same domain as the API via `/update*` and `/backup*` Caddy routes
// (either the bundled Caddyfile, using host.docker.internal, or your own external proxy)
// — see scripts/deploy.mjs for how HOST_AGENT_PORT/HOST_AGENT_BIND get chosen and wired up.
//
// Auth deliberately reuses JWT_SECRET from .env.prod rather than a separate secret: this
// is a personal single-user app, so any device already signed in can trigger an update or
// a backup, the same way it can already read/write all of that user's data via /sync/*.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cron from "node-cron";
import jwt from "jsonwebtoken";
import { composeFileFor, discardSafeLockfileDrift, readEnvValue } from "./lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const envProdPath = join(rootDir, ".env.prod");
const backupConfigPath = join(rootDir, ".backup-config.json");
const backupRunsPath = join(rootDir, ".backup-runs.json");
const backupSshDir = join(rootDir, ".backup-ssh");
const backupSshKeyPath = join(backupSshDir, "id_ed25519");

const jwtSecret = readEnvValue(envProdPath, "JWT_SECRET");
if (!jwtSecret) {
  console.error("JWT_SECRET not found in .env.prod — run `npm run deploy` at least once first.");
  process.exit(1);
}

const port = Number(readEnvValue(envProdPath, "HOST_AGENT_PORT") ?? 4001);
const bind = readEnvValue(envProdPath, "HOST_AGENT_BIND") ?? "0.0.0.0";

if (spawnSync("borg", ["--version"]).error) {
  console.warn("Warning: `borg` isn't on PATH — backups will fail until BorgBackup is installed on this host.");
}

function composeFlags() {
  const mode = readEnvValue(envProdPath, "PROXY_MODE") || "local";
  return `-f ${composeFileFor(mode)} --env-file .env.prod`;
}

// ---------------------------------------------------------------------------
// Shared run-state: only one host-mutating operation (update / backup / restore) at a
// time. They all touch the same Docker Compose stack and/or Borg repo, so letting two
// run concurrently (e.g. a restore landing mid-deploy) is exactly the kind of thing worth
// refusing outright rather than "probably fine."
// ---------------------------------------------------------------------------
const MAX_LOG_LINES = 500;
const updateState = { running: false, startedAt: null, finishedAt: null, exitCode: null, log: [] };
const backupState = { running: false, kind: null, archiveName: null, startedAt: null, finishedAt: null, exitCode: null, log: [] };

function anyBusy() {
  return updateState.running || backupState.running;
}

function appendLogTo(state, chunk) {
  const lines = chunk.toString().split("\n").filter(Boolean);
  state.log.push(...lines);
  if (state.log.length > MAX_LOG_LINES) state.log.splice(0, state.log.length - MAX_LOG_LINES);
}

// ---------------------------------------------------------------------------
// Update ("Update Server" button) — unchanged behavior/contract from before backups
// existed; see docs/deployment.md#triggering-an-update-from-the-app.
// ---------------------------------------------------------------------------
function startUpdate() {
  updateState.running = true;
  updateState.startedAt = new Date().toISOString();
  updateState.finishedAt = null;
  updateState.exitCode = null;
  updateState.log = [];
  const command = "git pull --ff-only && npm install && npm run deploy -- --skip-app";
  appendLogTo(updateState, `[update] Starting: ${command}`);

  // --skip-app: a UI button tap shouldn't silently kick off a cloud EAS build every time
  // (build minutes, and the first-ever build needs an interactive prompt this headless
  // process can't answer) — a full mobile rebuild still goes through `npm run deploy` by
  // hand, or `npm run deploy:app` for a JS-only OTA update.
  const child = spawn("sh", ["-c", command], { cwd: rootDir });
  child.stdout.on("data", (c) => appendLogTo(updateState, c));
  child.stderr.on("data", (c) => appendLogTo(updateState, c));
  child.on("close", (code) => {
    updateState.running = false;
    updateState.finishedAt = new Date().toISOString();
    updateState.exitCode = code;
    appendLogTo(updateState, `[update] Finished with exit code ${code}`);
  });
  child.on("error", (err) => {
    updateState.running = false;
    updateState.finishedAt = new Date().toISOString();
    updateState.exitCode = -1;
    appendLogTo(updateState, `[update] Failed to start: ${err.message}`);
  });
}

// ---------------------------------------------------------------------------
// Backup config: a small local JSON file, NOT a Postgres table. The main server has no
// host/Docker access (that's the whole reason this process exists), so it can't be the
// one running `borg`/`docker compose exec` either — keeping the repo/passphrase/schedule
// here, next to the process that actually acts on them, avoids inventing a way for a
// containerized server to call back out to a host script just to read its own settings.
// ---------------------------------------------------------------------------
function loadBackupConfig() {
  if (!existsSync(backupConfigPath)) return { repoUrl: null, passphrase: null, retentionCount: null, schedule: null };
  try {
    return JSON.parse(readFileSync(backupConfigPath, "utf8"));
  } catch {
    return { repoUrl: null, passphrase: null, retentionCount: null, schedule: null };
  }
}

function saveBackupConfig(cfg) {
  writeFileSync(backupConfigPath, JSON.stringify(cfg, null, 2));
}

function loadBackupRuns() {
  if (!existsSync(backupRunsPath)) return [];
  try {
    return JSON.parse(readFileSync(backupRunsPath, "utf8"));
  } catch {
    return [];
  }
}

function recordBackupRun(run) {
  const runs = loadBackupRuns();
  runs.unshift(run);
  writeFileSync(backupRunsPath, JSON.stringify(runs.slice(0, 50), null, 2));
}

// Plain-language schedule <-> cron, kept in exactly one place (here) so neither client
// needs its own copy of this logic — they just render the structured fields.
function buildCron(schedule) {
  if (!schedule || schedule.frequency === "off") return null;
  const { frequency, hour, minute, weekday, dayOfMonth } = schedule;
  if (frequency === "daily") return `${minute} ${hour} * * *`;
  if (frequency === "weekly") return `${minute} ${hour} * * ${weekday}`;
  if (frequency === "monthly") return `${minute} ${hour} ${dayOfMonth} * *`;
  return null;
}

function parseCron(cronStr) {
  if (!cronStr) return null;
  const [minute, hour, dayOfMonth, , weekday] = cronStr.split(" ");
  if (dayOfMonth !== "*") return { frequency: "monthly", hour: Number(hour), minute: Number(minute), weekday: null, dayOfMonth: Number(dayOfMonth) };
  if (weekday !== "*") return { frequency: "weekly", hour: Number(hour), minute: Number(minute), weekday: Number(weekday), dayOfMonth: null };
  return { frequency: "daily", hour: Number(hour), minute: Number(minute), weekday: null, dayOfMonth: null };
}

// ---------------------------------------------------------------------------
// Dedicated backup SSH identity, isolated from any ambient host SSH key — generated once,
// reused forever, so a remote (SSH) Borg repo can grant access to exactly this and
// nothing else (see docs/deployment.md#the-host-agent for the matching
// `authorized_keys` `command=` restriction to set up on the backup server's end).
// ---------------------------------------------------------------------------
// Tracks why generation hasn't produced a key yet, so the client can show a real error
// instead of a "Generating..." placeholder that never resolves. Previously this function
// swallowed both a missing `ssh-keygen` binary and a non-zero exit unconditionally —
// nothing ever surfaced that failure, so the UI just showed "Generating..." forever with
// no way to know why or to retry. Called again (cheap: one existsSync check when a key
// already exists) from both /backup/config handlers below, so a fixed environment (e.g.
// `ssh-keygen` installed after the fact) retries on the next request instead of needing a
// process restart.
let backupSshKeyError = null;

function ensureBackupSshKey() {
  if (existsSync(backupSshKeyPath)) {
    backupSshKeyError = null;
    return;
  }
  try {
    mkdirSync(backupSshDir, { recursive: true });
    const result = spawnSync("ssh-keygen", ["-t", "ed25519", "-f", backupSshKeyPath, "-N", "", "-C", "clocker-backup"]);
    if (result.error) {
      backupSshKeyError = `ssh-keygen isn't available on this host (${result.error.message}) — install OpenSSH's client tools (e.g. \`apt install openssh-client\`).`;
      console.warn(`Warning: ${backupSshKeyError}`);
      return;
    }
    if (result.status !== 0) {
      backupSshKeyError = result.stderr?.toString().trim() || `ssh-keygen exited with code ${result.status}`;
      console.warn(`Warning: backup SSH key generation failed: ${backupSshKeyError}`);
      return;
    }
    backupSshKeyError = null;
  } catch (err) {
    backupSshKeyError = err.message;
    console.warn(`Warning: backup SSH key generation failed: ${err.message}`);
  }
}

function getBackupSshPublicKey() {
  const pubPath = `${backupSshKeyPath}.pub`;
  return existsSync(pubPath) ? readFileSync(pubPath, "utf8").trim() : null;
}

function borgEnv(cfg) {
  return {
    ...process.env,
    BORG_PASSPHRASE: cfg.passphrase ?? "",
    BORG_RSH: `ssh -i ${backupSshKeyPath} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`,
  };
}

function ensureRepoInitialized(cfg) {
  const env = borgEnv(cfg);
  const info = spawnSync("borg", ["info", cfg.repoUrl], { env });
  if (info.status === 0) return;
  const init = spawnSync("borg", ["init", "--encryption", "repokey-blake2", cfg.repoUrl], { env });
  if (init.status !== 0) {
    throw new Error(`borg init failed: ${init.stderr?.toString() || init.error?.message || "unknown error"}`);
  }
}

function timestampForArchive() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// Invoked both from the HTTP handler (via setImmediate, so nothing there is left to catch
// a throw that escapes this function) and from the cron scheduler — every failure path
// MUST be caught inside this function's own try/catch, never thrown past its boundary, or
// it takes down the whole host agent process (this exact bug shipped once already; caught
// by actually triggering it locally, not just by reading the code).
function runBackupNow() {
  backupState.running = true;
  backupState.kind = "backup";
  backupState.archiveName = null;
  backupState.startedAt = new Date().toISOString();
  backupState.finishedAt = null;
  backupState.exitCode = null;
  backupState.log = [];

  const log = (line) => appendLogTo(backupState, line);
  let staging;
  try {
    const cfg = loadBackupConfig();
    if (!cfg.repoUrl || !cfg.passphrase) {
      throw new Error("Backup repo/passphrase aren't configured yet — set them in Settings first.");
    }
    log("[backup] Staging database dump and secrets...");
    staging = mkdtempSync(join(tmpdir(), "clocker-backup-"));
    const dump = spawnSync("sh", ["-c", `docker compose ${composeFlags()} exec -T postgres pg_dump -U clocker -Fc clocker > "${join(staging, "db.dump")}"`], {
      cwd: rootDir,
      shell: false,
    });
    if (dump.status !== 0) throw new Error(`pg_dump failed: ${dump.stderr?.toString() || "unknown error"}`);

    if (existsSync(envProdPath)) {
      writeFileSync(join(staging, ".env.prod"), readFileSync(envProdPath));
    } else {
      log("[backup] No .env.prod found on this host — skipping secrets in this archive.");
    }

    log("[backup] Ensuring the Borg repo is initialized...");
    ensureRepoInitialized(cfg);

    const archiveName = `clocker-${timestampForArchive()}`;
    log(`[backup] Creating archive ${archiveName}...`);
    const create = spawnSync("borg", ["create", "--compression", "zstd", `${cfg.repoUrl}::${archiveName}`, "."], {
      cwd: staging,
      env: borgEnv(cfg),
    });
    if (create.status !== 0) throw new Error(`borg create failed: ${create.stderr?.toString() || "unknown error"}`);
    backupState.archiveName = archiveName;
    log(`[backup] Archive ${archiveName} created.`);

    if (cfg.retentionCount) {
      log(`[backup] Pruning to the last ${cfg.retentionCount} archive(s)...`);
      const prune = spawnSync("borg", ["prune", "--keep-last", String(cfg.retentionCount), cfg.repoUrl], { env: borgEnv(cfg) });
      if (prune.status !== 0) log(`[backup] Warning: prune failed: ${prune.stderr?.toString() || "unknown error"}`);
    }

    backupState.exitCode = 0;
    log("[backup] Done.");
    recordBackupRun({
      kind: "backup",
      status: "success",
      archiveName,
      message: `Archive ${archiveName} created`,
      startedAt: backupState.startedAt,
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    backupState.exitCode = 1;
    log(`[backup] Failed: ${err.message}`);
    recordBackupRun({
      kind: "backup",
      status: "error",
      archiveName: backupState.archiveName,
      message: err.message,
      startedAt: backupState.startedAt,
      finishedAt: new Date().toISOString(),
    });
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
    backupState.running = false;
    backupState.finishedAt = new Date().toISOString();
  }
}

function listArchives() {
  const cfg = loadBackupConfig();
  if (!cfg.repoUrl || !cfg.passphrase) return [];
  const result = spawnSync("borg", ["list", "--json", cfg.repoUrl], { env: borgEnv(cfg) });
  if (result.status !== 0) throw new Error(result.stderr?.toString() || "borg list failed");
  const parsed = JSON.parse(result.stdout.toString());
  return (parsed.archives || []).map((a) => ({ name: a.name, time: a.time ?? a.start })).reverse();
}

// Same rule as runBackupNow above: called via setImmediate, so every failure path must be
// caught inside this function — nothing upstream can catch a throw that escapes it.
function restoreBackup({ archiveName, restoreDb, restoreEnv }) {
  backupState.running = true;
  backupState.kind = "restore";
  backupState.archiveName = archiveName;
  backupState.startedAt = new Date().toISOString();
  backupState.finishedAt = null;
  backupState.exitCode = null;
  backupState.log = [];

  const log = (line) => appendLogTo(backupState, line);
  let extractDir;
  try {
    const cfg = loadBackupConfig();
    if (!cfg.repoUrl || !cfg.passphrase) throw new Error("Backup repo/passphrase aren't configured.");

    // Pre-restore safety net, independent of Borg entirely — mirrors the pre-deploy
    // snapshot in scripts/deploy.mjs. A bad restore is then itself recoverable.
    log("[restore] Taking a pre-restore safety snapshot...");
    const backupsDir = join(rootDir, "backups");
    mkdirSync(backupsDir, { recursive: true });
    const safetyPath = join(backupsDir, `pre-restore-${timestampForArchive()}.sql`);
    const safety = spawnSync("sh", ["-c", `docker compose ${composeFlags()} exec -T postgres pg_dump -U clocker --clean --if-exists clocker > "${safetyPath}"`], { cwd: rootDir });
    if (safety.status !== 0) log(`[restore] Warning: pre-restore safety snapshot failed: ${safety.stderr?.toString() || "unknown error"} — continuing anyway.`);
    else log(`[restore] Safety snapshot saved to ${safetyPath}`);

    log(`[restore] Extracting archive ${archiveName}...`);
    extractDir = mkdtempSync(join(tmpdir(), "clocker-restore-"));
    const extract = spawnSync("borg", ["extract", `${cfg.repoUrl}::${archiveName}`], { cwd: extractDir, env: borgEnv(cfg) });
    if (extract.status !== 0) throw new Error(`borg extract failed: ${extract.stderr?.toString() || "unknown error"}`);

    if (restoreDb) {
      const dumpPath = join(extractDir, "db.dump");
      if (!existsSync(dumpPath)) throw new Error("Archive has no db.dump — nothing to restore for the database.");
      log("[restore] Restoring the database (pg_restore --clean --if-exists)...");
      const restore = spawnSync(
        "sh",
        ["-c", `docker compose ${composeFlags()} exec -T postgres pg_restore -U clocker --clean --if-exists -d clocker < "${dumpPath}"`],
        { cwd: rootDir },
      );
      if (restore.status !== 0) throw new Error(`pg_restore failed: ${restore.stderr?.toString() || "unknown error"}`);
      log("[restore] Database restored.");
    }

    if (restoreEnv) {
      const envPath = join(extractDir, ".env.prod");
      if (!existsSync(envPath)) throw new Error("Archive has no .env.prod — nothing to restore for secrets.");
      if (existsSync(envProdPath)) {
        writeFileSync(join(rootDir, `.env.prod.before-restore-${timestampForArchive()}`), readFileSync(envProdPath));
      }
      writeFileSync(envProdPath, readFileSync(envPath));
      log("[restore] .env.prod restored — if JWT_SECRET changed, every signed-in device will need to sign in again. Run `npm run deploy` to apply it.");
    }

    backupState.exitCode = 0;
    log("[restore] Done.");
    recordBackupRun({
      kind: "restore",
      status: "success",
      archiveName,
      message: `Restored from ${archiveName}${restoreDb ? " (db)" : ""}${restoreEnv ? " (secrets)" : ""}`,
      startedAt: backupState.startedAt,
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    backupState.exitCode = 1;
    log(`[restore] Failed: ${err.message}`);
    recordBackupRun({
      kind: "restore",
      status: "error",
      archiveName,
      message: err.message,
      startedAt: backupState.startedAt,
      finishedAt: new Date().toISOString(),
    });
  } finally {
    if (extractDir) rmSync(extractDir, { recursive: true, force: true });
    backupState.running = false;
    backupState.finishedAt = new Date().toISOString();
  }
}

// ---------------------------------------------------------------------------
// Scheduling — re-armed on startup and every time the schedule is saved via PATCH
// /backup/config, no restart needed.
// ---------------------------------------------------------------------------
let scheduledTask = null;
function rescheduleBackupCron() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  const cfg = loadBackupConfig();
  if (!cfg.schedule) return;
  scheduledTask = cron.schedule(cfg.schedule, () => {
    if (anyBusy()) return; // skip this tick rather than queue — the next one will pick it up
    try {
      runBackupNow();
    } catch {
      // runBackupNow already records the failure in run history; nothing more to do here.
    }
  });
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (!verifyAuth(req)) return send(401, { error: "Missing or invalid bearer token" });

  const url = new URL(req.url, "http://localhost");

  try {
    if (req.method === "POST" && url.pathname === "/update") {
      if (anyBusy()) return send(409, { error: "Another operation is already running" });
      // A locally modified package-lock.json alone (e.g. from an `npm install` run
      // directly on this host, outside the normal update flow) shouldn't block this
      // button forever — see discardSafeLockfileDrift's own comment for the exact rule
      // and why package.json also being dirty is the one case left alone.
      const { remaining } = discardSafeLockfileDrift(rootDir);
      if (remaining.length > 0) {
        return send(409, { error: "Server's working tree has uncommitted changes — resolve manually before updating." });
      }
      startUpdate();
      return send(202, { started: true });
    }

    if (req.method === "GET" && url.pathname === "/update/status") {
      return send(200, {
        running: updateState.running,
        startedAt: updateState.startedAt,
        finishedAt: updateState.finishedAt,
        exitCode: updateState.exitCode,
        log: updateState.log.join("\n"),
      });
    }

    if (req.method === "GET" && url.pathname === "/backup/config") {
      ensureBackupSshKey();
      const cfg = loadBackupConfig();
      return send(200, {
        repoUrl: cfg.repoUrl,
        passphraseSet: !!cfg.passphrase,
        retentionCount: cfg.retentionCount,
        schedule: parseCron(cfg.schedule),
        sshPublicKey: getBackupSshPublicKey(),
        sshPublicKeyError: backupSshKeyError,
      });
    }

    if (req.method === "PATCH" && url.pathname === "/backup/config") {
      const body = await readJsonBody(req);
      const cfg = loadBackupConfig();
      // No format validation here on purpose, matching Haydrop's equivalent settings
      // field — a Borg repo URL is whatever string the user says it is (local path,
      // user@host:path, ssh://...); trusting it and letting Borg itself be the judge
      // avoids this app guessing wrong about a syntax it doesn't own.
      if (typeof body.repoUrl === "string") cfg.repoUrl = body.repoUrl.trim();
      if (typeof body.passphrase === "string") cfg.passphrase = body.passphrase === "" ? null : body.passphrase;
      if (body.retentionCount === null || typeof body.retentionCount === "number") cfg.retentionCount = body.retentionCount;
      if (body.schedule === null) cfg.schedule = null;
      else if (body.schedule && typeof body.schedule === "object") cfg.schedule = buildCron(body.schedule);
      saveBackupConfig(cfg);
      rescheduleBackupCron();
      ensureBackupSshKey();
      return send(200, {
        repoUrl: cfg.repoUrl,
        passphraseSet: !!cfg.passphrase,
        retentionCount: cfg.retentionCount,
        schedule: parseCron(cfg.schedule),
        sshPublicKey: getBackupSshPublicKey(),
        sshPublicKeyError: backupSshKeyError,
      });
    }

    if (req.method === "POST" && url.pathname === "/backup/run") {
      if (anyBusy()) return send(409, { error: "Another operation is already running" });
      const cfg = loadBackupConfig();
      if (!cfg.repoUrl || !cfg.passphrase) {
        return send(400, { error: "Backup repo/passphrase aren't configured yet — set them in Settings first." });
      }
      backupState.running = true; // set synchronously so a fast poll right after sees "running"
      // Fire-and-forget: respond immediately, client polls /backup/status. runBackupNow
      // catches all of its own errors internally — see the comment on its definition for
      // why that's load-bearing, not just tidiness.
      setImmediate(() => runBackupNow());
      return send(202, { started: true });
    }

    if (req.method === "GET" && url.pathname === "/backup/status") {
      return send(200, {
        running: backupState.running,
        kind: backupState.kind,
        archiveName: backupState.archiveName,
        startedAt: backupState.startedAt,
        finishedAt: backupState.finishedAt,
        exitCode: backupState.exitCode,
        log: backupState.log.join("\n"),
      });
    }

    if (req.method === "GET" && url.pathname === "/backup/runs") {
      return send(200, { runs: loadBackupRuns() });
    }

    if (req.method === "GET" && url.pathname === "/backup/archives") {
      try {
        return send(200, { archives: listArchives() });
      } catch (err) {
        return send(400, { error: err.message });
      }
    }

    if (req.method === "POST" && url.pathname === "/backup/restore") {
      if (anyBusy()) return send(409, { error: "Another operation is already running" });
      const body = await readJsonBody(req);
      if (!body.archiveName) return send(400, { error: "archiveName is required" });
      if (!body.restoreDb && !body.restoreEnv) return send(400, { error: "Choose at least one of restoreDb/restoreEnv" });
      const cfg = loadBackupConfig();
      if (!cfg.repoUrl || !cfg.passphrase) {
        return send(400, { error: "Backup repo/passphrase aren't configured." });
      }
      backupState.running = true;
      setImmediate(() =>
        restoreBackup({ archiveName: body.archiveName, restoreDb: !!body.restoreDb, restoreEnv: !!body.restoreEnv }),
      );
      return send(202, { started: true });
    }

    send(404, { error: "Not found" });
  } catch (err) {
    send(500, { error: err.message });
  }
});

ensureBackupSshKey();
rescheduleBackupCron();

server.listen(port, bind, () => {
  console.log(`Clocker host agent listening on ${bind}:${port}`);
});
