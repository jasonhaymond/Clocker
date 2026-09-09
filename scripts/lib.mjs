import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";

// Plain-text section/step logging (no chalk dependency, so these scripts run with zero
// extra installs on a completely fresh clone).
export function section(title) {
  console.log(`\n=== ${title} ===`);
}

export function step(message) {
  console.log(`-> ${message}`);
}

export function warn(message) {
  console.log(`!  ${message}`);
}

export function fail(message) {
  console.error(`x  ${message}`);
  process.exit(1);
}

// Runs a command, streaming its output. Returns true/false instead of throwing when
// `optional` is set, so callers can degrade gracefully (e.g. Docker not installed).
export function run(command, { cwd, optional = false } = {}) {
  try {
    execSync(command, { cwd, stdio: "inherit" });
    return true;
  } catch (err) {
    if (optional) return false;
    fail(`Command failed: ${command}`);
    return false;
  }
}

export function commandExists(command) {
  try {
    execSync(command, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function captureOutput(command, { cwd } = {}) {
  try {
    return execSync(command, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

// Binds a throwaway server to `port` on all interfaces to check whether something else
// on this machine is already listening there. Checking 0.0.0.0 catches a process bound
// to a specific interface too (binding "any" fails if a specific-address bind already
// holds the port), which is what we care about — "would starting our own service here
// collide with something else already running."
export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "0.0.0.0");
  });
}

// Finds the first free port at or after `startPort`, so setup never hard-codes a port
// that happens to already be taken by some other app on this machine.
export async function findFreePort(startPort, attempts = 50) {
  for (let port = startPort; port < startPort + attempts; port++) {
    if (await isPortFree(port)) return port;
  }
  fail(`Could not find a free port in range ${startPort}-${startPort + attempts - 1}`);
}

// Replaces a `KEY=...` line in an env file if present, otherwise appends it — every other
// line (including comments, and any keys this script doesn't know about) is left exactly
// as it was. Creates the file if it doesn't exist yet. This is how a port choice
// "persists": once written, re-running setup reads it back with readEnvValue below
// instead of picking a new one, unless it's since become genuinely unavailable.
export function upsertEnvLine(filePath, key, value) {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8").split("\n") : [];
  while (existing.length && existing[existing.length - 1] === "") existing.pop();
  const line = `${key}=${value}`;
  const idx = existing.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) existing[idx] = line;
  else existing.push(line);
  writeFileSync(filePath, existing.join("\n") + "\n");
}

// Reads a `KEY=...` line from an env file, unwrapping surrounding quotes if present.
export function readEnvValue(filePath, key) {
  if (!existsSync(filePath)) return null;
  const match = readFileSync(filePath, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim().replace(/^"|"$/g, "") : null;
}
