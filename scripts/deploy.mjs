#!/usr/bin/env node
// One-command production deploy. Two modes, chosen by PROXY_MODE (persisted in
// .env.prod, defaults to "local"):
//   local     — the bundled Caddy (docker-compose.prod.yml) owns ports 80/443 and gets
//               you automatic HTTPS. Default; unchanged from before external-proxy
//               support existed.
//   external  — you already run your own reverse proxy (a separate Caddy/nginx/Traefik,
//               possibly on a different machine) and just want to add Clocker to it.
//               Uses docker-compose.prod.external-proxy.yml instead: no bundled Caddy,
//               the server's and web client's own ports are published for your proxy to
//               reach, and this script prints a ready-to-paste Caddy site block (both
//               under one domain, path-routed) at the end.
// The web client always deploys alongside the API in both modes — see
// docs/deployment.md for the full walkthrough, including the external-proxy path.
//
// The mobile app builds here too (via EAS Build), by design — not as a separate process
// you have to remember to run. Pass --skip-app to skip it for one run (e.g. a quick
// backend-only iteration); a JS-only change between full deploys should usually go out
// via `npm run deploy:app` (an OTA update) instead of a full rebuild here.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureOutput,
  commandExists,
  composeFileFor,
  fail,
  findFreePort,
  readEnvValue,
  run,
  section,
  step,
  upsertEnvLine,
  warn,
} from "./lib.mjs";
import { checkBakedApiUrl, checkEasLogin } from "./eas-helpers.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const appDir = join(rootDir, "app");
const envProdPath = join(rootDir, ".env.prod");

const args = process.argv.slice(2);
function flagValue(name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] !== undefined ? args[idx + 1] : fallback;
}
const wantsExternal = args.includes("--external-proxy");
const wantsLocal = args.includes("--local-proxy");
const wantsSkipApp = args.includes("--skip-app");
const appPlatform = flagValue("--app-platform", "android");
const appProfile = flagValue("--app-profile", "preview");
// Excludes both the flag names above and the values immediately following them, so
// `--app-platform android` can't be mistaken for the positional domain argument (neither
// "--app-platform" nor "android" starts with "--", so a plain "doesn't start with --"
// filter alone would wrongly match "android" as the domain in some argument orderings).
const valueFlags = ["--app-platform", "--app-profile"];
const consumedIndices = new Set();
for (const flag of valueFlags) {
  const idx = args.indexOf(flag);
  if (idx >= 0) {
    consumedIndices.add(idx);
    consumedIndices.add(idx + 1);
  }
}
const domainArg = args.find((a, i) => !a.startsWith("--") && !consumedIndices.has(i));

section("Checking prerequisites");
if (!commandExists("docker --version")) {
  fail("Docker isn't installed or isn't on PATH. Install Docker, then re-run `npm run deploy`.");
}
if (!commandExists("docker compose version")) {
  fail("Docker Compose isn't available (need the `docker compose` plugin, not standalone docker-compose v1). Install/upgrade Docker, then re-run.");
}

section("Configuring .env.prod");

const domain = readEnvValue(envProdPath, "DOMAIN") || process.env.DOMAIN || domainArg;
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
step("The web client deploys on this same domain (path-routed alongside the API).");

const previousProxyMode = readEnvValue(envProdPath, "PROXY_MODE");
let proxyMode = wantsExternal ? "external" : wantsLocal ? "local" : previousProxyMode || "local";
if (proxyMode !== "local" && proxyMode !== "external") {
  warn(`Unrecognized PROXY_MODE "${proxyMode}" in .env.prod — defaulting to "local".`);
  proxyMode = "local";
}
step(`Proxy mode: ${proxyMode}${proxyMode === "external" ? " (your own reverse proxy)" : " (bundled Caddy)"}`);

if (previousProxyMode && previousProxyMode !== proxyMode) {
  section("Switching proxy mode");
  step(`Stopping the previous "${previousProxyMode}" stack before starting "${proxyMode}"...`);
  run(`docker compose -f ${composeFileFor(previousProxyMode)} --env-file .env.prod down --remove-orphans`, { cwd: rootDir, optional: true });
}
upsertEnvLine(envProdPath, "PROXY_MODE", proxyMode);

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

let serverPort = null;
let webPort = null;
if (proxyMode === "external") {
  // Only scanned for a free port the *first* time (when unset) — once chosen, a port is
  // reused unconditionally on every later deploy, never re-verified. This is a deliberate
  // "new deployment vs. routine update" distinction (see the global dev-standards doc's
  // port-selection guidance): re-checking on every run is actively wrong here, because
  // the thing that would normally be "using" this port is this exact stack's own
  // already-running server/web container — a plain socket-bind freshness check can't
  // distinguish "taken by something else" from "taken by the container this same command
  // is about to reuse," so it always reports the port busy and picks a new one, forever
  // incrementing on every redeploy. If a configured port is ever genuinely unavailable
  // (something unrelated grabbed it while this stack was down), `docker compose up` fails
  // with a clear "port already allocated" error — fix it by hand then (edit .env.prod),
  // the same pattern as changing a dev port in docs/development.md.
  serverPort = readEnvValue(envProdPath, "SERVER_PORT");
  if (serverPort) {
    step(`Using configured server port ${serverPort} (not re-scanned on redeploy — see .env.prod.example if you need to change it)`);
  } else {
    serverPort = String(await findFreePort(3001));
    step(`Port 3001+ scanned — selected ${serverPort} for the server`);
  }
  upsertEnvLine(envProdPath, "SERVER_PORT", serverPort);
  if (!readEnvValue(envProdPath, "SERVER_BIND")) {
    upsertEnvLine(envProdPath, "SERVER_BIND", "0.0.0.0");
    step("SERVER_BIND not set — defaulting to 0.0.0.0 (all interfaces); see .env.prod.example to restrict it.");
  }

  webPort = readEnvValue(envProdPath, "WEB_PORT");
  if (webPort) {
    step(`Using configured web port ${webPort} (not re-scanned on redeploy — see .env.prod.example if you need to change it)`);
  } else {
    // Only scanned fresh (never re-verified afterward, per above) — starts after
    // whatever SERVER_PORT is, so a first-ever setup can't pick the same port for both.
    webPort = String(await findFreePort(Number(serverPort) + 1));
    step(`Port ${Number(serverPort) + 1}+ scanned — selected ${webPort} for the web client`);
  }
  upsertEnvLine(envProdPath, "WEB_PORT", webPort);
  if (!readEnvValue(envProdPath, "WEB_BIND")) {
    upsertEnvLine(envProdPath, "WEB_BIND", "0.0.0.0");
    step("WEB_BIND not set — defaulting to 0.0.0.0 (all interfaces); see .env.prod.example to restrict it.");
  }
}

section("Configuring the host agent");
// Independent of PROXY_MODE — the host agent is a host process either way (never a Docker
// container, see scripts/host-agent.mjs for why), so it needs a real host port
// regardless of whether the bundled Caddy or an external one is reaching it. Same
// "scanned once, then reused forever" rule as SERVER_PORT/WEB_PORT above.
let hostAgentPort = readEnvValue(envProdPath, "HOST_AGENT_PORT");
if (hostAgentPort) {
  step(`Using configured host agent port ${hostAgentPort} (not re-scanned on redeploy)`);
} else {
  hostAgentPort = String(await findFreePort(4001));
  step(`Port 4001+ scanned — selected ${hostAgentPort} for the host agent`);
}
upsertEnvLine(envProdPath, "HOST_AGENT_PORT", hostAgentPort);
if (!readEnvValue(envProdPath, "HOST_AGENT_BIND")) {
  upsertEnvLine(envProdPath, "HOST_AGENT_BIND", "0.0.0.0");
}

if (!commandExists("pm2 --version")) {
  warn("pm2 isn't installed — the in-app \"Update Server\"/\"Back Up Now\" buttons won't work until the host agent is running.");
  warn("Install pm2 (`npm install -g pm2`) then run:");
  warn(`  pm2 start scripts/host-agent.mjs --name clocker-host-agent --cwd "${rootDir}" && pm2 save`);
  warn("Or run it under systemd instead — see docs/deployment.md#the-host-agent for a ready-to-paste unit file.");
} else {
  const alreadyManaged = captureOutput("pm2 jlist", { cwd: rootDir })?.includes('"name":"clocker-host-agent"');
  if (alreadyManaged) {
    step("Restarting the already-running clocker-host-agent pm2 process...");
    run("pm2 restart clocker-host-agent", { cwd: rootDir, optional: true });
  } else {
    step("Starting the clocker-host-agent pm2 process for the first time...");
    run(`pm2 start scripts/host-agent.mjs --name clocker-host-agent --cwd "${rootDir}"`, { cwd: rootDir, optional: true });
  }
  run("pm2 save", { cwd: rootDir, optional: true });
}

const composeFlags = `-f ${composeFileFor(proxyMode)} --env-file .env.prod`;

if (proxyMode === "local") {
  section("Checking DNS");
  const resolved = captureOutput(`dig +short ${domain}`) || captureOutput(`getent hosts ${domain}`)?.split(/\s+/)[0] || null;
  if (resolved) {
    step(`${domain} currently resolves to ${resolved.split("\n")[0]}`);
  } else {
    warn(`Couldn't resolve ${domain} from this machine. If DNS hasn't propagated yet, Caddy`);
    warn(`will keep retrying its certificate request on its own — check \`docker compose ${composeFlags} logs caddy\` if it's taking a while.`);
  }
}

section("Snapshotting the database");
// Unconditional, independent of any other backup mechanism — see the global dev-standards
// doc's backup guidance. Every deploy changes what's running (a new image at minimum),
// and it's cheap insurance against exactly the kind of "why is the database suddenly
// empty" surprise a bad interaction between an unrelated change and Docker's own
// recreate-on-config-change behavior can cause — this is the one thing that makes such a
// surprise recoverable instead of catastrophic. Skipped gracefully on a brand-new
// deployment, where there's no existing database yet to snapshot.
const postgresRunning = captureOutput(`docker compose ${composeFlags} ps --status running --services`, { cwd: rootDir })
  ?.split("\n")
  .includes("postgres");
if (postgresRunning) {
  const backupsDir = join(rootDir, "backups");
  mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupsDir, `clocker-${stamp}.sql`);
  // --clean --if-exists: prefixes each object with a DROP IF EXISTS, so restoring is
  // safe whether the target already has the schema (the common "just lost some rows"
  // case) or is completely empty (a fresh volume) — without this, restoring onto an
  // intact schema spams "already exists" errors for every table/index/constraint
  // (harmless — psql keeps going and the data still restores — but alarming to see
  // during a real incident, and worth avoiding).
  const dumped = run(`docker compose ${composeFlags} exec -T postgres pg_dump -U clocker --clean --if-exists clocker > "${backupPath}"`, {
    cwd: rootDir,
    optional: true,
  });
  if (dumped) {
    step(`Saved to ${backupPath}`);
  } else {
    warn(`Couldn't snapshot the database — see the error above. Continuing anyway, but there's no rollback point for this deploy.`);
  }
} else {
  step("No database running yet (first deploy) — nothing to snapshot.");
}

section("Building and starting the stack");
// --remove-orphans cleans up containers from a previous compose file/config that no
// longer matches this one (e.g. a stale service left over from before a profile or
// service was renamed) — without it they linger and can hold ports/names the new
// containers need.
run(`docker compose ${composeFlags} up -d --build --remove-orphans`, { cwd: rootDir });

section("Verifying");
const expectedServices = proxyMode === "local" ? ["postgres", "server", "web", "caddy"] : ["postgres", "server", "web"];
step(`Waiting for all ${expectedServices.length} containers to report running...`);
let allRunning = false;
const runningDeadline = Date.now() + 60_000;
while (Date.now() < runningDeadline) {
  const running = captureOutput(`docker compose ${composeFlags} ps --status running --services`, { cwd: rootDir });
  const services = new Set(running ? running.split("\n") : []);
  if (expectedServices.every((s) => services.has(s))) {
    allRunning = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

if (!allRunning) {
  warn("Not all containers reported running in time. Check what's wrong with:");
  warn(`  docker compose ${composeFlags} ps`);
  warn(`  docker compose ${composeFlags} logs`);
} else if (proxyMode === "local") {
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
    step(`Reached https://${domain}/health successfully.`);
  } else {
    warn(`Couldn't reach https://${domain}/health yet from this machine.`);
    warn("This can be DNS propagation delay, port 80/443 not actually open to the internet,");
    warn("or — if this server is behind home NAT — an inability to reach its own public IP");
    warn("(try curling from another machine instead). See docs/deployment.md#troubleshooting.");
  }
  step("Checking the web client through Caddy (same domain, different path)...");
  let webHealthy = false;
  const webDeadline = Date.now() + 30_000;
  while (Date.now() < webDeadline) {
    if (captureOutput(`curl -sf https://${domain}/`) !== null) {
      webHealthy = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (webHealthy) {
    step(`Reached https://${domain}/ successfully.`);
  } else {
    warn(`Couldn't reach https://${domain}/ yet — same possible causes as the API above.`);
  }
} else {
  step("All containers running. Checking the server directly (not through your external proxy)...");
  let healthy = false;
  const healthDeadline = Date.now() + 20_000;
  while (Date.now() < healthDeadline) {
    if (captureOutput(`curl -sf http://localhost:${serverPort}/health`) !== null) {
      healthy = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (healthy) {
    step(`Reached http://localhost:${serverPort}/health successfully.`);
  } else {
    warn(`Couldn't reach http://localhost:${serverPort}/health on this machine — the server itself may still be starting or failing.`);
    warn(`  docker compose ${composeFlags} logs server`);
  }
  step("Checking the web client directly (not through your external proxy)...");
  let webHealthy = false;
  const webDeadline = Date.now() + 20_000;
  while (Date.now() < webDeadline) {
    if (captureOutput(`curl -sf http://localhost:${webPort}/`) !== null) {
      webHealthy = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (webHealthy) {
    step(`Reached http://localhost:${webPort}/ successfully.`);
  } else {
    warn(`Couldn't reach http://localhost:${webPort}/ on this machine — the web container may still be starting or failing.`);
    warn(`  docker compose ${composeFlags} logs web`);
  }
}

let appBuildStarted = false;
if (wantsSkipApp) {
  section("Skipping mobile app build (--skip-app)");
} else {
  section(`Building the mobile app (${appPlatform}, ${appProfile} profile)`);
  if (!commandExists("npx --version")) {
    warn("npx isn't available — skipping the mobile app build. Install Node.js locally to enable this step.");
  } else {
    const dirty = captureOutput("git status --porcelain -- app shared", { cwd: rootDir });
    if (dirty) {
      warn("app/ or shared/ has uncommitted changes — skipping the mobile app build so it doesn't ship unreviewed code.");
      warn("Commit or stash, then re-run `npm run deploy` to include it.");
    } else {
      const whoami = captureOutput("npx eas-cli@latest whoami", { cwd: appDir });
      if (!whoami || /not logged in/i.test(whoami)) {
        warn("Not logged in to EAS — skipping the mobile app build.");
        warn("Run `cd app && npx eas-cli@latest login`, then re-run `npm run deploy` to include it.");
      } else {
        step(`Logged in to EAS as ${whoami}`);
        checkBakedApiUrl(rootDir, appDir, appProfile);
        // Deliberately not --non-interactive: the very first build ever needs to ask
        // (interactively, right here) which EAS account/project to link, and forcing
        // non-interactive mode turns that prompt into a hard failure ("EAS project not
        // configured... cannot configure it in non-interactive mode") instead of asking.
        // That one-time answer gets written to app.json (commit it afterward) — every
        // build after that is unattended again on its own, nothing more to answer.
        step("Submitting to EAS Build (--no-wait only skips waiting for the *build* to finish — if this is the very first build ever, EAS may ask here which account/project to link; answer it, this part isn't skippable)...");
        appBuildStarted = run(`npx eas-cli@latest build --platform ${appPlatform} --profile ${appProfile} --no-wait`, {
          cwd: appDir,
          optional: true,
        });
        if (!appBuildStarted) {
          warn("Failed to submit the mobile app build — see the error above. The server/web deploy above is unaffected.");
        }
      }
    }
  }
}

section("Done");
const appBuildLine = appBuildStarted
  ? "Mobile app: build submitted to EAS — it'll print a download link/QR code when it finishes (`eas build:list` to check status)."
  : wantsSkipApp
    ? "Mobile app: skipped (--skip-app)."
    : "Mobile app: not built this run — see the warning above for why, and how to include it next time.";
const updaterManaged = commandExists("pm2 --version") && captureOutput("pm2 jlist", { cwd: rootDir })?.includes('"name":"clocker-host-agent"');
const updaterLine = updaterManaged
  ? "Update-trigger service: running under pm2 as \"clocker-host-agent\" — the in-app \"Update Server\" button is live."
  : "Update-trigger service: NOT running — see the warning above to start it before the in-app \"Update Server\" button will work.";
if (proxyMode === "local") {
  console.log(`
Server: https://${domain}
Web client: https://${domain}/
${appBuildLine}
${updaterLine}

Useful commands:
  docker compose ${composeFlags} ps        # container status
  docker compose ${composeFlags} logs -f   # follow logs
  docker compose ${composeFlags} down      # stop everything (add -v to also wipe the database)

Re-run \`npm run deploy\` any time to rebuild and restart with the latest code — it reuses
the domain/password/secret already in .env.prod rather than generating new ones.
`);
} else {
  console.log(`
The server and web client are running on this machine, published on ports ${serverPort}
and ${webPort} respectively — not reachable from the internet by themselves. Add this to
your own reverse proxy's config, pointed at this machine, so both are reachable under one
domain the same way the bundled Caddyfile routes them:

--- paste into your Caddy config ---
${domain} {
    handle /health {
        reverse_proxy <this-machine's-address>:${serverPort}
    }
    handle /auth/* {
        reverse_proxy <this-machine's-address>:${serverPort}
    }
    handle /sync/* {
        reverse_proxy <this-machine's-address>:${serverPort}
    }
    handle /update* {
        reverse_proxy <this-machine's-address>:${hostAgentPort}
    }
    handle /backup* {
        reverse_proxy <this-machine's-address>:${hostAgentPort}
    }
    handle {
        reverse_proxy <this-machine's-address>:${webPort}
    }
}
-------------------------------------

Replace <this-machine's-address> with whatever your proxy can use to reach this host —
its LAN IP, a private network hostname, a VPN/Tailscale address, etc. (this script can't
know which, since your proxy runs elsewhere). Not using Caddy on the other end? Translate
the same "path -> this host:port" rules into your proxy's own config format.

Make sure ports ${serverPort}, ${webPort}, and ${hostAgentPort} are actually reachable from your
proxy's machine — a firewall rule scoped to its specific IP is safer than leaving it open
to everything. See docs/deployment.md#deploying-behind-your-own-reverse-proxy.

${appBuildLine}
${updaterLine}

Useful commands:
  docker compose ${composeFlags} ps        # container status
  docker compose ${composeFlags} logs -f   # follow logs
  docker compose ${composeFlags} down      # stop everything (add -v to also wipe the database)

Re-run \`npm run deploy\` any time to rebuild and restart with the latest code — it reuses
the domain/password/secret/ports already in .env.prod rather than generating new ones.
`);
}
