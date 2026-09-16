import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

export interface AuthTokenPayload {
  userId: string;
  // Checked against the user's current tokenVersion on every request (see requireAuth
  // below) — the only revocation mechanism available for an otherwise-stateless JWT.
  // Bumped by /auth/change-password and /auth/logout-everywhere, at which point every
  // previously-issued token (on every device) starts failing this check.
  tokenVersion: number;
}

// "Remember me" (checked by default on both clients) means the token never expires —
// jsonwebtoken simply omits the `exp` claim when `expiresIn` isn't passed at all, which
// is valid per the JWT spec. Unchecking it falls back to a short-lived token instead, so
// declining to be remembered actually means something rather than just changing where
// the token is stored client-side. This is independent of tokenVersion-based revocation
// above — even a never-expiring token stops working the moment it's revoked.
export function signToken(payload: AuthTokenPayload, rememberMe: boolean): string {
  return rememberMe ? jwt.sign(payload, JWT_SECRET as string) : jwt.sign(payload, JWT_SECRET as string, { expiresIn: "1d" });
}

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

// Fastify preHandler that requires a valid "Authorization: Bearer <token>" header whose
// embedded tokenVersion still matches the user's current one in the database. That extra
// lookup (one indexed query per request) is the cost of making revocation possible at all
// for a stateless JWT — negligible at this app's scale, and the same tradeoff every
// session-based auth scheme makes by definition.
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, JWT_SECRET as string) as AuthTokenPayload;
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { tokenVersion: true } });
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      return reply.code(401).send({ error: "Invalid or expired token" });
    }
    request.userId = payload.userId;
  } catch {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}
