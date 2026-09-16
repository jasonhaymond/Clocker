import nodemailer from "nodemailer";

// Server-sent email is only used for password reset — every other "email" feature in this
// app (timesheet submission, invoice delivery) hands off to the device's own mail app via
// expo-mail-composer/mailto: instead, since those are always triggered by a signed-in user
// with a mail client of their own. Forgot-password has no signed-in user and no client to
// hand off to, so it's the one place this app actually needs to send mail itself — which
// means it's also the one feature that depends on a self-hoster having real SMTP
// credentials configured. Deliberately optional at the type level (isConfigured() below)
// rather than a hard startup requirement like JWT_SECRET, so upgrading to a version with
// this feature doesn't break a server that hasn't set SMTP_* yet — /auth/forgot-password
// just reports it's unavailable until it is.
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Reset your Clocker password",
    text: `Someone (hopefully you) requested a password reset for this email address.\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password hasn't been changed.`,
    html: `<p>Someone (hopefully you) requested a password reset for this email address.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password hasn't been changed.</p>`,
  });
}
