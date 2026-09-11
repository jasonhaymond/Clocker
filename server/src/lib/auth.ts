import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

export interface AuthTokenPayload {
  userId: string;
}

// "Remember me" (checked by default on both clients) means the token never expires —
// jsonwebtoken simply omits the `exp` claim when `expiresIn` isn't passed at all, which
// is valid per the JWT spec. Unchecking it falls back to a short-lived token instead, so
// declining to be remembered actually means something rather than just changing where
// the token is stored client-side.
export function signToken(payload: AuthTokenPayload, rememberMe: boolean): string {
  return rememberMe ? jwt.sign(payload, JWT_SECRET as string) : jwt.sign(payload, JWT_SECRET as string, { expiresIn: "1d" });
}

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

// Fastify preHandler that requires a valid "Authorization: Bearer <token>" header.
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, JWT_SECRET as string) as AuthTokenPayload;
    request.userId = payload.userId;
  } catch {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}
