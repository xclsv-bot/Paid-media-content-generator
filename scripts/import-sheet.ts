/**
 * seed:sheet - post the paid team's weekly report CSV to /api/metrics/import.
 *
 *   npm run seed:sheet -- path/to/report.csv
 *
 * The heavy lifting (header normalization, verdict parsing, upsert, store
 * refresh) lives in the route so the app and this CLI share one code path;
 * this script only reads the file and POSTs it.
 *
 * Env:
 *   APP_URL        base URL of the running app (default http://localhost:3000)
 *   AGENT_API_KEY  bearer token the import route accepts (see src/lib/agent-auth.ts)
 */
import { readFile } from "node:fs/promises";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: npm run seed:sheet -- <report.csv>");
    process.exit(1);
  }
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const key = process.env.AGENT_API_KEY;
  if (!key) {
    console.error("AGENT_API_KEY is required (the import route rejects unauthenticated agents).");
    process.exit(1);
  }

  const csv = await readFile(file, "utf8");
  const res = await fetch(`${base}/api/metrics/import`, {
    method: "POST",
    headers: { "Content-Type": "text/csv", Authorization: `Bearer ${key}` },
    body: csv,
  });
  const body = (await res.json().catch(() => ({}))) as {
    imported?: number;
    unmatched?: string[];
    refresh?: unknown;
    error?: string;
  };
  if (!res.ok) {
    console.error(`Import failed (${res.status}): ${body.error ?? "unknown error"}`);
    process.exit(1);
  }

  console.log(`Imported ${body.imported ?? 0} row(s).`);
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
