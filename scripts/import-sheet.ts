/**
 * seed:sheet — parse the paid team's weekly report (CSV/TSV) and post it to
 * /api/metrics, which upserts creative_metrics and rebuilds the loop's stores.
 *
 *   npm run seed:sheet -- path/to/report.csv ["Week of Jul 6"]
 *
 * Parsing is shared with the in-app importer (src/lib/metrics/report.ts) so the
 * CLI and the paste UI agree on headers and verdicts; this script only reads the
 * file, parses it to rows, and POSTs { rows }.
 *
 * Env:
 *   APP_URL        base URL of the running app (default http://localhost:3000)
 *   AGENT_API_KEY  bearer token /api/metrics accepts (see src/lib/agent-auth.ts)
 *   ORG_ID         client organization uuid the rows belong to — report rows
 *                  are org-stamped (0026), so the import must name its tenant
 */
import { readFile } from "node:fs/promises";
import { parseReport } from "../src/lib/metrics/report";

async function main() {
  const file = process.argv[2];
  const flightLabel = process.argv[3] ?? "default";
  if (!file) {
    console.error('usage: npm run seed:sheet -- <report.csv> ["Flight label"]');
    process.exit(1);
  }
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const key = process.env.AGENT_API_KEY;
  if (!key) {
    console.error("AGENT_API_KEY is required (the import route rejects unauthenticated agents).");
    process.exit(1);
  }
  const orgId = process.env.ORG_ID;
  if (!orgId) {
    console.error("ORG_ID is required (the client org uuid the report belongs to).");
    process.exit(1);
  }

  const text = await readFile(file, "utf8");
  const { rows, warnings } = parseReport(text, flightLabel);
  for (const w of warnings) console.warn(`! ${w}`);
  if (rows.length === 0) {
    console.error("No rows parsed — nothing to import.");
    process.exit(1);
  }

  const res = await fetch(`${base}/api/metrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ rows, org_id: orgId }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    imported?: number;
    matched?: number;
    unmatched?: string[];
    refresh?: unknown;
    error?: string;
  };
  if (!res.ok) {
    console.error(`Import failed (${res.status}): ${body.error ?? "unknown error"}`);
    process.exit(1);
  }

  console.log(`Imported ${body.imported ?? 0} row(s); ${body.matched ?? 0} matched a concept.`);
  if (body.unmatched?.length) {
    console.warn(`\n${body.unmatched.length} ad name(s) matched no creative (fix the naming or add the concept):`);
    for (const name of body.unmatched) console.warn(`  - ${name}`);
  }
  console.log(`\nStore refresh: ${JSON.stringify(body.refresh)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
