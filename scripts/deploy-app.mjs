#!/usr/bin/env node
// Ships a JS/asset-only change to an already-installed mobile build via `eas update` —
// no new install needed on any device. This is the *lightweight, separate* path,
// distinct from a real app build: a full build (new native deps, an Expo SDK bump,
// app.json's native-affecting config) happens as part of `npm run deploy` itself (see
// scripts/deploy.mjs), not as its own process — this script is only for the JS-only case
// in between full deploys. See docs/deployment.md#deploying-the-expo-app.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureOutput, commandExists, fail, run, section, step } from "./lib.mjs";
import { checkBakedApiUrl, checkEasLogin } from "./eas-helpers.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const appDir = join(rootDir, "app");

const args = process.argv.slice(2);
const messageArg = args.find((a, i) => args[i - 1] === "--message") ?? null;

section("Checking prerequisites");
if (!commandExists("npx --version")) {
  fail("npx isn't available — install Node.js, then re-run.");
}

section("Checking for uncommitted changes");
// A published update should be exactly what's committed — otherwise a later `git pull`
// on this or another machine silently diverges from what's actually live.
const dirty = captureOutput("git status --porcelain -- app shared", { cwd: rootDir });
if (dirty) {
  fail(
    [
      "app/ or shared/ has uncommitted changes — commit or stash them first:",
      dirty
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
    ].join("\n"),
  );
}
step("Working tree clean.");

section("Checking EAS login");
checkEasLogin(appDir);

section("Cross-checking EXPO_PUBLIC_API_URL");
checkBakedApiUrl(rootDir, appDir, "production");

const message = messageArg ?? captureOutput("git log -1 --format=%s", { cwd: rootDir }) ?? "Update";
section("Publishing OTA update (branch: production)");
step(`Message: ${message}`);
run(`npx eas-cli@latest update --branch production --message "${message.replace(/"/g, '\\"')}"`, { cwd: appDir });

section("Done");
console.log(`
Published. Already-installed builds pick this up on next launch/foreground (see
docs/development.md#ota-updates) — nothing to reinstall.

Touched native code (a new native dependency, an Expo SDK bump, app.json's native-affecting
config)? This update won't cover that — it needs a real build, which happens as part of
\`npm run deploy\` (see scripts/deploy.mjs), not this script.
`);
