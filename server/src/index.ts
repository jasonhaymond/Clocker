import "dotenv/config";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { authRoutes } from "./routes/auth.js";
import { syncRoutes } from "./routes/sync.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
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
