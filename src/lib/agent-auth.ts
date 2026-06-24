import { timingSafeEqual } from "crypto";

// Validate a Bearer token against AGENT_API_KEY in constant time.
// Returns false if the header is missing/malformed or no key is configured.
export function isAuthorizedAgent(req: Request): boolean {
  const configured = process.env.AGENT_API_KEY;
  if (!configured) return false;

  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(configured);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
