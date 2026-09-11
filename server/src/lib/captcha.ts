import { randomUUID } from "node:crypto";

// A self-hosted, no-external-dependency alternative to a third-party CAPTCHA (reCAPTCHA/
// Turnstile/etc.) — deliberately not meant to stop a determined, targeted attacker; it's
// there to filter out the generic credential-stuffing/signup-spam bots that don't bother
// solving even trivial challenges when easier undefended targets exist. Combined with
// per-IP rate limiting on the same routes (see server/src/index.ts) for the rest of the
// defense. In-memory only — losing these across a server restart just means an
// in-flight captcha has to be re-fetched, not a real problem.
interface CaptchaEntry {
  answer: number;
  expiresAt: number;
}

const CAPTCHA_TTL_MS = 5 * 60_000;
const captchas = new Map<string, CaptchaEntry>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [id, entry] of captchas) {
    if (entry.expiresAt < now) captchas.delete(id);
  }
}

export function generateCaptcha(): { id: string; question: string } {
  sweepExpired();
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const id = randomUUID();
  captchas.set(id, { answer: a + b, expiresAt: Date.now() + CAPTCHA_TTL_MS });
  return { id, question: `What is ${a} + ${b}?` };
}

// Single-use: consumed whether the answer is right or wrong, so a script can't just
// retry the same id repeatedly until it happens to guess correctly.
export function verifyCaptcha(id: string, answer: number): boolean {
  const entry = captchas.get(id);
  captchas.delete(id);
  if (!entry || entry.expiresAt < Date.now()) return false;
  return entry.answer === answer;
}
