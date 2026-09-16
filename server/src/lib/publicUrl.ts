// The server's own externally-reachable base URL — used anywhere an absolute link needs
// to be built (an invoice's shareable link, a password-reset link in an email). Can't be
// inferred from the request alone in every deployment shape (behind a reverse proxy,
// etc.), so it's configured explicitly. Falls back to reconstructing it from the incoming
// request's own protocol/host for local dev, where PUBLIC_URL is typically left unset.
export function publicBaseUrl(request: { protocol: string; hostname: string; headers: Record<string, unknown> }): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const host = (request.headers["host"] as string | undefined) ?? request.hostname;
  return `${request.protocol}://${host}`;
}
