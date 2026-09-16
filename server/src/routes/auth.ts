import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateCaptcha, verifyCaptcha } from "../lib/captcha.js";
import { isEmailConfigured, sendPasswordResetEmail } from "../lib/email.js";
import { prisma } from "../lib/prisma.js";
import { publicBaseUrl } from "../lib/publicUrl.js";
import { requireAuth, signToken } from "../lib/auth.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  captchaId: z.string(),
  captchaAnswer: z.coerce.number(),
  rememberMe: z.boolean().optional().default(true),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const RESET_TOKEN_TTL_MS = 60 * 60_000;

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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
    // Deliberately checked before even validating the body — a server with registration
    // closed shouldn't reveal anything about whether a given email/CAPTCHA combination
    // would otherwise have worked. Off (registration open) unless explicitly set to
    // "false", so upgrading to this version changes nothing until a self-hoster opts in.
    if (process.env.REGISTRATION_ENABLED === "false") {
      return reply.code(403).send({ error: "Registration is currently closed on this server." });
    }
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
    const token = signToken({ userId: user.id, tokenVersion: user.tokenVersion }, rememberMe);
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

    const token = signToken({ userId: user.id, tokenVersion: user.tokenVersion }, rememberMe);
    return reply.send({ token, userId: user.id });
  });

  // Requires the current password (not just a valid session) before changing it — a
  // logged-in-but-unattended device shouldn't be enough on its own to lock the real owner
  // out. Bumping tokenVersion here is what actually closes
  // docs/deployment.md#security-gaps-to-close-before-this-is-public's "no revocation"
  // gap: every other token this user has ever been issued (any device, any "remember me"
  // session) stops working the instant this succeeds. A fresh token is returned so the
  // device that just changed the password doesn't also get logged out by its own action.
  app.post("/auth/change-password", { preHandler: requireAuth, config: { rateLimit: authRateLimit } }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { currentPassword, newPassword } = parsed.data;
    const userId = request.userId as string;

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return reply.code(401).send({ error: "Current password is incorrect" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    const token = signToken({ userId: updated.id, tokenVersion: updated.tokenVersion }, true);
    return reply.send({ token });
  });

  // Bumps tokenVersion with no new token issued — including for the device that made
  // this request, deliberately: "log out everywhere" means everywhere. The client that
  // called this should clear its own local session immediately rather than expecting to
  // keep using the token it just invalidated.
  app.post("/auth/logout-everywhere", { preHandler: requireAuth, config: { rateLimit: authRateLimit } }, async (request, reply) => {
    const userId = request.userId as string;
    await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    return reply.send({ ok: true });
  });

  // Always responds with the same generic message regardless of whether the email is
  // registered, to avoid using this endpoint to enumerate accounts — the one exception is
  // "email isn't configured on this server at all," which is safe to disclose since it's
  // a blanket fact about this deployment, not something specific to the submitted email,
  // and a self-hoster who hasn't set up SMTP yet needs to actually see that rather than a
  // silent no-op that looks like a sent email that never arrives.
  app.post("/auth/forgot-password", { config: { rateLimit: authRateLimit } }, async (request, reply) => {
    if (!isEmailConfigured()) {
      return reply.code(503).send({ error: "Password reset isn't configured on this server. Contact whoever manages it." });
    }
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (user) {
      const rawToken = randomBytes(32).toString("hex");
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetTokenHash: hashResetToken(rawToken), passwordResetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      });
      const resetUrl = `${publicBaseUrl(request)}/reset-password?token=${rawToken}`;
      try {
        await sendPasswordResetEmail(user.email, resetUrl);
      } catch (err) {
        request.log.error(err, "Failed to send password reset email");
        // Deliberately still returns the generic success message below — a delivery
        // failure here is a server-side problem to fix, not something to expose to
        // whoever submitted the form (which could be an attacker probing this endpoint).
      }
    }
    return reply.send({ message: "If that email is registered, a password reset link has been sent." });
  });

  // Also revokes every existing session (tokenVersion bump) — resetting a forgotten
  // password is exactly the scenario where an old, possibly-compromised token should stop
  // working too, same as a deliberate password change above.
  app.post("/auth/reset-password", { config: { rateLimit: authRateLimit } }, async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { token, newPassword } = parsed.data;

    const user = await prisma.user.findFirst({
      where: { passwordResetTokenHash: hashResetToken(token), passwordResetExpiresAt: { gt: new Date() } },
    });
    if (!user) {
      return reply.code(400).send({ error: "This reset link is invalid or has expired. Request a new one." });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordResetTokenHash: null, passwordResetExpiresAt: null, tokenVersion: { increment: 1 } },
    });
    return reply.send({ message: "Password reset. Sign in with your new password." });
  });
}
