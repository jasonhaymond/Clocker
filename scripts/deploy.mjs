#!/usr/bin/env node
// One-command production deploy. Two modes, chosen by PROXY_MODE (persisted in
// .env.prod, defaults to "local"):
//   local     — the bundled Caddy (docker-compose.prod.yml) owns ports 80/443 and gets
//               you automatic HTTPS. Default; unchanged from before external-proxy
//               support existed.
//   external  — you already run your own reverse proxy (a separate Caddy/nginx/Traefik,
//               possibly on a different machine) and just want to add Clocker to it.
//               Uses docker-compose.prod.external-proxy.yml instead: no bundled Caddy,
//               the server's own port is published for your proxy to reach, and this
//               script prints a ready-to-paste Caddy site block at the end.
// Pass --web to also build and start the web client (opt-in, persisted in .env.prod as
// DEPLOY_WEB same as PROXY_MODE) — --no-web turns it back off. Works with either proxy
// mode: local gets a second Caddy site block on WEB_DOMAIN, external gets its own
// published port (WEB_PORT/WEB_BIND, same idea as SERVER_PORT/SERVER_BIND).
// See docs/deployment.md for the full walkthrough, including the external-proxy and
// web-client paths.
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureOutput,
  commandExists,
  fail,
  findFreePort,
  isPortFree,
  readEnvValue,
  run,
  section,
  step,
  upsertEnvLine,
  warn,
} from "./lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const envProdPath = join(rootDir, ".env.prod");

const args = process.argv.slice(2);
const wantsExternal = args.includes("--external-proxy");
const wantsLocal = args.includes("--local-proxy");
const wantsWeb = args.includes("--web");
const wantsNoWeb = args.includes("--no-web");
const domainArg = args.find((a) => !a.startsWith("--"));

function composeFileFor(mode) {
  return mode === "external" ? "docker-compose.prod.external-proxy.yml" : "docker-compose.prod.yml";
}

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
  run(`docker compose -f ${composeFileFor(previousProxyMode)} --env-file .env.prod --profile web down`, { cwd: rootDir, optional: true });
}
upsertEnvLine(envProdPath, "PROXY_MODE", proxyMode);

const previousDeployWeb = readEnvValue(envProdPath, "DEPLOY_WEB") === "true";
const deployWeb = wantsWeb ? true : wantsNoWeb ? false : previousDeployWeb;
upsertEnvLine(envProdPath, "DEPLOY_WEB", String(deployWeb));
step(`Web client: ${deployWeb ? "deploying" : "not deploying"} (pass --web / --no-web to change)`);

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
if (proxyMode === "external") {
  const configured = readEnvValue(envProdPath, "SERVER_PORT");
  if (configured && (await isPortFree(Number(configured)))) {
    serverPort = configured;
    step(`Using existing server port ${serverPort}`);
  } else {
    if (configured) warn(`Configured server port ${configured} is now in use by something else on this machine — picking a new one.`);
    serverPort = String(await findFreePort(3001));
    step(`Port 3001+ scanned — selected ${serverPort} for the server`);
  }
  upsertEnvLine(envProdPath, "SERVER_PORT", serverPort);
  if (!readEnvValue(envProdPath, "SERVER_BIND")) {
    upsertEnvLine(envProdPath, "SERVER_BIND", "0.0.0.0");
    step("SERVER_BIND not set — defaulting to 0.0.0.0 (all interfaces); see .env.prod.example to restrict it.");
  }
}

let webDomain = null;
let webPort = null;
if (deployWeb) {
  if (proxyMode === "local") {
    webDomain = readEnvValue(envProdPath, "WEB_DOMAIN");
    if (!webDomain) {
      webDomain = "web.localhost";
      warn(`WEB_DOMAIN isn't set — the web client will only be reachable as https://${webDomain} (not on the`);
      warn("internet). Set WEB_DOMAIN in .env.prod to a real hostname with its own DNS record before relying on this.");
      upsertEnvLine(envProdPath, "WEB_DOMAIN", webDomain);
    } else {
      step(`Web domain: ${webDomain}`);
    }
  } else {
    const configured = readEnvValue(envProdPath, "WEB_PORT");
    if (configured && (await isPortFree(Number(configured)))) {
      webPort = configured;
      step(`Using existing web port ${webPort}`);
    } else {
      if (configured) warn(`Configured web port ${configured} is now in use by something else on this machine — picking a new one.`);
      webPort = String(await findFreePort(3002));
      step(`Port 3002+ scanned — selected ${webPort} for the web client`);
    }
    upsertEnvLine(envProdPath, "WEB_PORT", webPort);
    if (!readEnvValue(envProdPath, "WEB_BIND")) {
      upsertEnvLine(envProdPath, "WEB_BIND", "0.0.0.0");
      step("WEB_BIND not set — defaulting to 0.0.0.0 (all interfaces); see .env.prod.example to restrict it.");
    }
  }
}

const composeFlags = `-f ${composeFileFor(proxyMode)} --env-file .env.prod${deployWeb ? " --profile web" : ""}`;

if (proxyMode === "local") {
  section("Checking DNS");
  const resolved = captureOutput(`dig +short ${domain}`) || captureOutput(`getent hosts ${domain}`)?.split(/\s+/)[0] || null;
  if (resolved) {
    step(`${domain} currently resolves to ${resolved.split("\n")[0]}`);
  } else {
    warn(`Couldn't resolve ${domain} from this machine. If DNS hasn't propagated yet, Caddy`);
    warn(`will keep retrying its certificate request on its own — check \`docker compose ${composeFlags} logs caddy\` if it's taking a while.`);
  }
  if (deployWeb && webDomain !== "web.localhost") {
    const webResolved = captureOutput(`dig +short ${webDomain}`) || captureOutput(`getent hosts ${webDomain}`)?.split(/\s+/)[0] || null;
    if (webResolved) {
      step(`${webDomain} currently resolves to ${webResolved.split("\n")[0]}`);
    } else {
      warn(`Couldn't resolve ${webDomain} from this machine either — same DNS-propagation caveat as above.`);
    }
  }
}

section("Building and starting the stack");
run(`docker compose ${composeFlags} up -d --build`, { cwd: rootDir });

section("Verifying");
const expectedServices = [
  "postgres",
  "server",
  ...(proxyMode === "local" ? ["caddy"] : []),
  ...(deployWeb ? ["web"] : []),
];
step(`Waiting for ${expectedServices.length === 1 ? "the" : "all"} ${expectedServices.length} container${expectedServices.length === 1 ? "" : "s"} to report running...`);
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
  if (deployWeb) {
    step("Checking the web client through Caddy...");
    let webHealthy = false;
    const webDeadline = Date.now() + 30_000;
    while (Date.now() < webDeadline) {
      if (captureOutput(`curl -sf https://${webDomain}/`) !== null) {
        webHealthy = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (webHealthy) {
      step(`Reached https://${webDomain}/ successfully.`);
    } else {
      warn(`Couldn't reach https://${webDomain}/ yet — same possible causes as the API above.`);
    }
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
  if (deployWeb) {
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
}

section("Done");
if (proxyMode === "local") {
  console.log(`
Server: https://${domain}${deployWeb ? `\nWeb client: https://${webDomain}` : ""}

Useful commands:
  docker compose ${composeFlags} ps        # container status
  docker compose ${composeFlags} logs -f   # follow logs
  docker compose ${composeFlags} down      # stop everything (add -v to also wipe the database)

Re-run \`npm run deploy\` any time to rebuild and restart with the latest code — it reuses
the domain/password/secret${deployWeb ? "/web settings" : ""} already in .env.prod rather than generating new ones.
`);
} else {
  const webBlock = deployWeb
    ? `

The web client is running the same way, published on port ${webPort}. Add its own site
block to your reverse proxy too (a different hostname than the API's, e.g.
app.${domain}):

--- paste into your Caddy config ---
app.${domain} {
    reverse_proxy <this-machine's-address>:${webPort}
}
-------------------------------------
`
    : "";
  console.log(`
The server is running on this machine, published on port ${serverPort} — not reachable
from the internet by itself. Add this to your own reverse proxy's config, pointed at
this machine:

--- paste into your Caddy config ---
${domain} {
    reverse_proxy <this-machine's-address>:${serverPort}
}
-------------------------------------
${webBlock}
Replace <this-machine's-address> with whatever your proxy can use to reach this host —
its LAN IP, a private network hostname, a VPN/Tailscale address, etc. (this script can't
know which, since your proxy runs elsewhere). Not using Caddy on the other end? Translate
that same "domain -> this host:port" rule into your proxy's own config format.

Make sure ${deployWeb ? `ports ${serverPort} and ${webPort} are` : `port ${serverPort} is`} actually reachable from your proxy's
machine — a firewall rule scoped to its specific IP is safer than leaving it open to
everything. See docs/deployment.md#deploying-behind-your-own-reverse-proxy.

Useful commands:
  docker compose ${composeFlags} ps        # container status
  docker compose ${composeFlags} logs -f   # follow logs
  docker compose ${composeFlags} down      # stop everything (add -v to also wipe the database)

Re-run \`npm run deploy\` any time to rebuild and restart with the latest code — it reuses
the domain/password/secret/port${deployWeb ? "/web settings" : ""} already in .env.prod rather than generating new ones.
`);
}
