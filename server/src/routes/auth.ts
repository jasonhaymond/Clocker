import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateCaptcha, verifyCaptcha } from "../lib/captcha.js";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/auth.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  captchaId: z.string(),
  captchaAnswer: z.coerce.number(),
  rememberMe: z.boolean().optional().default(true),
});

// Rate limit config shared by both auth routes — generous enough for someone fumbling
// their own password a few times, tight enough to blunt a scripted credential-stuffing
// attempt. See server/src/index.ts for why this isn't applied globally.
const authRateLimit = { max: 10, timeWindow: "15 minutes" };

export async function authRoutes(app: FastifyInstance) {
  // Looser than the login/register limit below — a legitimate client fetches one of
  // these per attempt (including retries after a wrong answer), but still capped so
  // spamming this endpoint can't grow the in-memory captcha store unbounded.
  app.get("/auth/captcha", { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } }, async () => generateCaptcha());

  app.post("/auth/register", { config: { rateLimit: authRateLimit } }, async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { email, password, captchaId, captchaAnswer, rememberMe } = parsed.data;

    if (!verifyCaptcha(captchaId, captchaAnswer)) {
      return reply.code(400).send({ error: "Incorrect answer to the verification question — fetch a new one and try again." });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { email, passwordHash } });
    const token = signToken({ userId: user.id }, rememberMe);
    return reply.code(201).send({ token, userId: user.id });
  });

  app.post("/auth/login", { config: { rateLimit: authRateLimit } }, async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { email, password, captchaId, captchaAnswer, rememberMe } = parsed.data;

    if (!verifyCaptcha(captchaId, captchaAnswer)) {
      return reply.code(400).send({ error: "Incorrect answer to the verification question — fetch a new one and try again." });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const token = signToken({ userId: user.id }, rememberMe);
    return reply.send({ token, userId: user.id });
  });
}
