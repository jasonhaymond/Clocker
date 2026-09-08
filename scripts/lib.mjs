import { execSync } from "node:child_process";

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
