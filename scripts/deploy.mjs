#!/usr/bin/env node
// One-command production deploy: generates .env.prod (POSTGRES_PASSWORD, JWT_SECRET) the
// same way scripts/setup.mjs generates server/.env for local dev — auto-filled, generated
// once, then persisted and reused on every later run — so the only thing you ever have to
// supply yourself is DOMAIN, which nothing on this machine could safely guess for you.
// Then builds and starts docker-compose.prod.yml, and verifies it actually came up.
// See docs/deployment.md for the full walkthrough and troubleshooting.
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureOutput, commandExists, fail, readEnvValue, run, section, step, upsertEnvLine, warn } from "./lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const envProdPath = join(rootDir, ".env.prod");
const composeFlags = "-f docker-compose.prod.yml --env-file .env.prod";

section("Checking prerequisites");
if (!commandExists("docker --version")) {
  fail("Docker isn't installed or isn't on PATH. Install Docker, then re-run `npm run deploy`.");
}
if (!commandExists("docker compose version")) {
  fail("Docker Compose isn't available (need the `docker compose` plugin, not standalone docker-compose v1). Install/upgrade Docker, then re-run.");
}

section("Configuring .env.prod");

// DOMAIN is the one thing nothing here can fill in for you — accept it from an env var
// or a CLI arg on first run, but once it's in .env.prod that's the value used from then
// on, so re-running `npm run deploy` later never requires repeating it.
const domain = readEnvValue(envProdPath, "DOMAIN") || process.env.DOMAIN || process.argv[2];
if (!domain) {
  fail(
    [
      "DOMAIN isn't set yet. Supply it one of these ways and re-run:",
      "    npm run deploy -- your-domain.com",
      "    DOMAIN=your-domain.com npm run deploy",
      "  or set DOMAIN=your-domain.com directly in .env.prod",
    ].join("\n"),
  );
}
upsertEnvLine(envProdPath, "DOMAIN", domain);
step(`Domain: ${domain}`);

let postgresPassword = readEnvValue(envProdPath, "POSTGRES_PASSWORD");
if (postgresPassword) {
  step("Using existing POSTGRES_PASSWORD");
} else {
  postgresPassword = randomBytes(24).toString("hex");
  step("Generated a new POSTGRES_PASSWORD");
}
upsertEnvLine(envProdPath, "POSTGRES_PASSWORD", postgresPassword);

let jwtSecret = readEnvValue(envProdPath, "JWT_SECRET");
if (jwtSecret) {
  step("Using existing JWT_SECRET");
} else {
  jwtSecret = randomBytes(48).toString("hex");
  step("Generated a new JWT_SECRET");
}
upsertEnvLine(envProdPath, "JWT_SECRET", jwtSecret);

section("Checking DNS");
// Purely informational — Caddy will keep retrying the ACME challenge on its own if DNS
// hasn't propagated yet, so a failed/missing lookup here is a warning, not a hard stop.
const resolved =
  captureOutput(`dig +short ${domain}`) || captureOutput(`getent hosts ${domain}`)?.split(/\s+/)[0] || null;
if (resolved) {
  step(`${domain} currently resolves to ${resolved.split("\n")[0]}`);
} else {
  warn(`Couldn't resolve ${domain} from this machine. If DNS hasn't propagated yet, Caddy`);
  warn("will keep retrying its certificate request on its own — check `docker compose " + composeFlags + " logs caddy` if it's taking a while.");
}

section("Building and starting the stack");
run(`docker compose ${composeFlags} up -d --build`, { cwd: rootDir });

section("Verifying");
step("Waiting for all three containers to report running...");
let allRunning = false;
const runningDeadline = Date.now() + 60_000;
while (Date.now() < runningDeadline) {
  const running = captureOutput(`docker compose ${composeFlags} ps --status running --services`, { cwd: rootDir });
  const services = new Set(running ? running.split("\n") : []);
  if (["postgres", "server", "caddy"].every((s) => services.has(s))) {
    allRunning = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!allRunning) {
  warn("Not all containers reported running in time. Check what's wrong with:");
  warn(`  docker compose ${composeFlags} ps`);
  warn(`  docker compose ${composeFlags} logs`);
} else {
  step("All containers running. Checking the API through Caddy...");
  let healthy = false;
  const healthDeadline = Date.now() + 30_000;
  while (Date.now() < healthDeadline) {
    if (captureOutput(`curl -sf https://${domain}/health`) !== null) {
      healthy = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (healthy) {
    step("Reached https://" + domain + "/health successfully.");
  } else {
    warn(`Couldn't reach https://${domain}/health yet from this machine.`);
    warn("This can be DNS propagation delay, port 80/443 not actually open to the internet,");
    warn("or — if this server is behind home NAT — an inability to reach its own public IP");
    warn("(try curling from another machine instead). See docs/deployment.md#troubleshooting.");
  }
}

section("Done");
console.log(`
Server: https://${domain}

Useful commands:
  docker compose ${composeFlags} ps        # container status
  docker compose ${composeFlags} logs -f   # follow logs
  docker compose ${composeFlags} down      # stop everything (add -v to also wipe the database)

Re-run \`npm run deploy\` any time to rebuild and restart with the latest code — it reuses
the domain/password/secret already in .env.prod rather than generating new ones.
`);
