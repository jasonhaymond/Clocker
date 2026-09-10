import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The one monorepo-specific bit: @clocker/shared is a sibling workspace, not a published
// package, so Vite needs to know it's allowed to watch/serve files outside web/ itself.
export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [".."] },
  },
});
