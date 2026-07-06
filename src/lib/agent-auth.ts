import { timingSafeEqual } from "crypto";

// Constant-time compare of a Bearer token against a configured secret.
// Returns false if the header is missing/malformed or no secret is configured.
function bearerMatches(req: Request, configured: string | undefined): boolean {
  if (!configured) return false;
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(configured);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// The external script agent (AGENT_API_KEY).
export function isAuthorizedAgent(req: Request): boolean {
  return bearerMatches(req, process.env.AGENT_API_KEY);
}

// Vercel Cron (CRON_SECRET). Vercel attaches `Authorization: Bearer $CRON_SECRET`
// to scheduled invocations when CRON_SECRET is set in the project env.
export function isAuthorizedCron(req: Request): boolean {
  return bearerMatches(req, process.env.CRON_SECRET);
}
