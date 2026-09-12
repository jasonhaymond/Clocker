import "dotenv/config";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { authRoutes } from "./routes/auth.js";
import { syncRoutes } from "./routes/sync.js";

const app = Fastify({ logger: true });

// CORS only matters for browser requests (the mobile app and any other non-browser
// client never send an Origin header, so this doesn't affect them either way). In
// production the web client deploys on the same domain as the API (path-routed by
// Caddy), so its own requests are same-origin and don't need CORS at all — this only
// gates a browser on some *other* origin. CORS_ORIGIN (set by the prod Compose files to
// https://$DOMAIN) is a comma-separated allowlist; falling back to permissive localhost
// origins when unset keeps `web`'s Vite dev server (a different port than the API)
// working during local development without hardcoding a specific dev port.
const configuredOrigins = process.env.CORS_ORIGIN?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

await app.register(cors, {
  origin:
    configuredOrigins && configuredOrigins.length > 0
      ? configuredOrigins
      : /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/,
});
// global: false — only routes that opt in via `config: { rateLimit: {...} }` (the auth
// routes) are limited; the sync routes stay unlimited since they're already
// token-authenticated and called opportunistically/frequently by legitimate clients.
await app.register(rateLimit, { global: false });

app.get("/health", async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(syncRoutes);

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
