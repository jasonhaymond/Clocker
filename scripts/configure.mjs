#!/usr/bin/env node
// Interactive setup for the optional production settings that can't be auto-generated
// the way POSTGRES_PASSWORD/JWT_SECRET are — email (for password reset), closing
// registration, the Android Google Maps key, and the EAS project id. Nothing here is
// required for `npm run deploy` to work; skip anything you don't need. Safe to re-run —
// asks before replacing anything already set.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closePrompt, confirm, prompt, readEnvValue, section, step, upsertEnvLine } from "./lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const envProdPath = join(rootDir, ".env.prod");
const appEnvPath = join(rootDir, "app", ".env");

if (!process.stdin.isTTY) {
  console.error("This needs an interactive terminal — run `npm run configure` directly, not from another script.");
  process.exit(1);
}

async function setValue(filePath, key, question, defaultValue = "") {
  const existing = readEnvValue(filePath, key);
  if (existing && !(await confirm(`${key} is already set — replace it?`))) return existing;
  const value = await prompt(question, existing || defaultValue);
  if (value) upsertEnvLine(filePath, key, value);
  return value;
}

section("Email (password reset) — .env.prod");
console.log(
  "Optional. Nothing else in Clocker sends email on its own — only \"Forgot password?\"\n" +
    "links need this. Skip it and whoever runs the server can still reset a password\n" +
    "directly in the database.",
);
if (await confirm("Set up email now?")) {
  await setValue(envProdPath, "SMTP_HOST", "SMTP host (e.g. smtp.your-provider.com)");
  await setValue(envProdPath, "SMTP_PORT", "SMTP port", "587");
  upsertEnvLine(envProdPath, "SMTP_SECURE", (await confirm("Use implicit TLS? (usually port 465 — say no for STARTTLS/587)")) ? "true" : "");
  await setValue(envProdPath, "SMTP_USER", "SMTP username");
  await setValue(envProdPath, "SMTP_PASS", "SMTP password (typed in plain — this is a local terminal, not sent anywhere)");
  await setValue(envProdPath, "SMTP_FROM", 'From address, e.g. "Clocker <noreply@your-domain.com>"');
  step("Saved. Takes effect on the next `npm run deploy` or `npm run update`.");
} else {
  step("Skipped.");
}

section("Registration — .env.prod");
console.log("Optional. Close signups once your intended users have all registered.");
const registrationClosed = readEnvValue(envProdPath, "REGISTRATION_ENABLED") === "false";
if (registrationClosed) {
  if (await confirm("Registration is currently closed — reopen it?")) {
    upsertEnvLine(envProdPath, "REGISTRATION_ENABLED", "true");
    step("Reopened.");
  } else {
    step("Left closed.");
  }
} else if (await confirm("Close registration now?")) {
  upsertEnvLine(envProdPath, "REGISTRATION_ENABLED", "false");
  step("Closed. Run this again to reopen it.");
} else {
  step("Left open (default).");
}

section("Google Maps API key (Android location picker) — app/.env");
console.log(
  "Optional. Without it, \"Choose on Map\" isn't available on Android (iOS is unaffected —\n" +
    "it uses Apple Maps for free); \"Use My Current Location\" and \"Enter an Address\" both\n" +
    "still work either way. See docs/deployment.md's Step 1 for how to get one from the\n" +
    "Google Cloud Console.",
);
await setValue(appEnvPath, "ANDROID_GOOGLE_MAPS_API_KEY", "Google Maps API key (blank to skip)");

section("EAS project id — app/.env");
console.log(
  "Only needed once, the first time `npm run deploy` builds the mobile app — if that's\n" +
    "already happened, this is already set and there's nothing to do here. See\n" +
    "docs/deployment.md's Step 1 if it hasn't.",
);
await setValue(appEnvPath, "EAS_PROJECT_ID", "EAS project id (blank to skip)");

closePrompt();
section("Done");
console.log("Re-run `npm run deploy` to apply anything changed above.");
