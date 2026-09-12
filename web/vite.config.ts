import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"));

// The one monorepo-specific bit: @clocker/shared is a sibling workspace, not a published
// package, so Vite needs to know it's allowed to watch/serve files outside web/ itself.
export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [".."] },
  },
  // Bakes web/package.json's version into the client bundle at build time (Vite doesn't
  // expose package.json to browser code on its own) — shown in Settings, and now kept in
  // lockstep with app/package.json + shared/package.json on every release (server keeps
  // its own independent 0.x version; see STATUS.md).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
