// Shared between scripts/deploy.mjs (builds the app as part of a full deploy) and
// scripts/deploy-app.mjs (OTA updates only, the lighter/separate path for JS-only
// changes between full deploys).
import { execSync } from "node:child_process";
import { join } from "node:path";
import { captureOutput, fail, readEnvValue, step, warn } from "./lib.mjs";

export function checkEasLogin(appDir) {
  const whoami = captureOutput("npx eas-cli@latest whoami", { cwd: appDir });
  if (!whoami || /not logged in/i.test(whoami)) {
    fail("Not logged in to EAS. Run `cd app && npx eas-cli@latest login`, then re-run.");
  }
  step(`Logged in to EAS as ${whoami}`);
  return whoami;
}

// A build/update baking in the wrong API URL is exactly the bug that shipped earlier in
// this project's history (see docs/deployment.md's EAS section) — cheap to catch here,
// before spending a build (or an OTA publish) on the wrong domain.
export function checkBakedApiUrl(rootDir, appDir, profile) {
  const easJsonPath = join(appDir, "eas.json");
  let bakedUrl = null;
  try {
    const easJson = JSON.parse(execSync(`node -e "console.log(require('fs').readFileSync(process.argv[1],'utf8'))" "${easJsonPath}"`).toString());
    bakedUrl = easJson?.build?.[profile]?.env?.EXPO_PUBLIC_API_URL ?? null;
  } catch {
    warn(`Couldn't read app/eas.json's "${profile}" profile env — skipping this check.`);
    return;
  }
  const deployedDomain = readEnvValue(join(rootDir, ".env.prod"), "DOMAIN");
  if (bakedUrl && deployedDomain) {
    const expected = `https://${deployedDomain}`;
    if (bakedUrl !== expected) {
      warn(`app/eas.json's "${profile}" profile bakes in ${bakedUrl}, but .env.prod's DOMAIN is ${deployedDomain} (${expected}).`);
      warn("If that's not intentional, update app/eas.json before shipping.");
    } else {
      step(`app/eas.json's "${profile}" profile matches the deployed domain (${expected}).`);
    }
  } else if (bakedUrl) {
    step(`app/eas.json's "${profile}" profile bakes in ${bakedUrl} (no local .env.prod to cross-check against).`);
  }
}
