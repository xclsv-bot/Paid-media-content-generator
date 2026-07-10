import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { Anthropic, createAnthropic, NOT_CONFIGURED } from "@/lib/anthropic";
import { parseVerdict, type ReportRow } from "@/lib/metrics/report";

export const maxDuration = 300;

// The report arrives as a screenshot/photo of the sheet, so extraction has to
// read the table visually. Numbers come back as plain numbers; ratios come
// back as decimals (0.46% -> 0.0046) per the schema instructions; verdicts are
// normalized server-side so STOP_TEST -> KILL etc. can't drift.
const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ad_name: {
            type: "string",
            description:
              "The creative/ad name EXACTLY as printed, preserving every separator and space (e.g. 'XCLSV _ XCLSV _ WNBA _ Video _ No Face _ Information _ 15s _ 07.03.26').",
          },
          spend: { type: ["number", "null"], description: "Flight spend in dollars, e.g. 156.69" },
          conversions: { type: ["number", "null"], description: "Conversions/trials (flight_conv), whole number" },
          cpa: { type: ["number", "null"], description: "Flight CPA in dollars; null when blank (zero conversions)" },
          ctr: { type: ["number", "null"], description: "CTR as a DECIMAL RATIO: 0.46% -> 0.0046" },
          bau_cpa: { type: ["number", "null"], description: "Benchmark / BAU CPA in dollars" },
          verdict: {
            type: ["string", "null"],
            description: "The verdict text as printed (e.g. ITERATE, STOP_TEST, KEEP_TESTING, GRADUATE/PROMOTE)",
          },
          reason: { type: ["string", "null"], description: "The reason column text, verbatim" },
          cpm: { type: ["number", "null"], description: "CPM in dollars" },
          cpi: { type: ["number", "null"], description: "CPI in dollars" },
          cps: { type: ["number", "null"], description: "CPS in dollars" },
          icvr: { type: ["number", "null"], description: "iCVR as a decimal ratio: 55% -> 0.55" },
          scvr: { type: ["number", "null"], description: "sCVR/pCVR as a decimal ratio: 18% -> 0.18" },
          aov: { type: ["number", "null"], description: "AOV in dollars" },
          roas: { type: ["number", "null"], description: "ROAS as printed, e.g. 0.17" },
        },
        required: [
          "ad_name", "spend", "conversions", "cpa", "ctr", "bau_cpa", "verdict", "reason",
          "cpm", "cpi", "cps", "icvr", "scvr", "aov", "roas",
        ],
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      description: "Anything ambiguous or unreadable in the image worth flagging to the operator.",
    },
  },
  required: ["rows", "warnings"],
} as const;

const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// ~4MB of base64 keeps the request under serverless body limits; the client
// downscales photos before upload.
const MAX_BASE64_CHARS = 5_500_000;

// POST /api/metrics/extract  { image: <base64>, mediaType, flightLabel }
// Staff-only. Reads the weekly-report photo and returns ReportRow[] shaped for
// the same preview + POST /api/metrics import path the paste flow uses.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let client: Anthropic;
  try {
    client = createAnthropic();
  } catch {
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }

  const { image, mediaType, flightLabel } = (await req.json().catch(() => ({}))) as {
    image?: string;
    mediaType?: string;
    flightLabel?: string;
  };
  if (!image || typeof image !== "string") {
    return NextResponse.json({ error: "image (base64) is required" }, { status: 400 });
  }
  if (image.length > MAX_BASE64_CHARS) {
    return NextResponse.json(
      { error: "Image too large — retake or crop to just the table and try again." },
      { status: 400 },
    );
  }
  if (!mediaType || !ALLOWED_MEDIA.has(mediaType)) {
    return NextResponse.json({ error: "mediaType must be a JPEG/PNG/WebP/GIF image type" }, { status: 400 });
  }
  const label = typeof flightLabel === "string" && flightLabel.trim() ? flightLabel.trim() : "default";

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: image } },
            {
              type: "text",
              text: `This is a photo of our weekly paid-social creative report ("Creative Testing - Graduation").

Extract one row per creative. When the image contains BOTH a summary table and a detailed table with verdict/reason columns, prefer the detailed table for spend/conversions/CPA/CTR/benchmark/verdict/reason, and fill CPM/CPI/CPS/iCVR/sCVR (pCVR)/AOV/ROAS from the summary table by matching ad names. If a name appears in only one table, still emit its row with what's available.

Rules:
- ad_name must be copied EXACTLY as printed, including the " _ " separators, internal spaces ("No Face"), duration slots ("15s"), and date tokens — it is a database join key.
- Blank/empty cells -> null. Never invent a value.
- Percentages -> decimal ratios (0.46% -> 0.0046, 55% -> 0.55).
- Dollar figures -> plain numbers (\$156.69 -> 156.69).
- verdict/reason verbatim as printed.`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "Couldn't read this image." }, { status: 422 });
    }
    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "{}";
    const parsed = JSON.parse(raw) as { rows?: Array<Record<string, unknown>>; warnings?: string[] };

    const warnings: string[] = Array.isArray(parsed.warnings) ? parsed.warnings.slice(0, 10) : [];
    const rows: ReportRow[] = [];
    for (const r of parsed.rows ?? []) {
      const adName = typeof r.ad_name === "string" ? r.ad_name.trim() : "";
      if (!adName) continue;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const rawVerdict = typeof r.verdict === "string" ? r.verdict : null;
      const verdict = rawVerdict ? parseVerdict(rawVerdict) : null;
      if (rawVerdict && !verdict) warnings.push(`Unrecognized verdict “${rawVerdict}” on “${adName}” — left blank.`);
      rows.push({
        ad_name: adName,
        flight_label: label,
        flight_start: null,
        spend: num(r.spend),
        conversions: num(r.conversions) != null ? Math.round(num(r.conversions)!) : null,
        cpa: num(r.cpa),
        ctr: num(r.ctr),
        bau_cpa: num(r.bau_cpa),
        verdict,
        reason: typeof r.reason === "string" ? r.reason : null,
        cpm: num(r.cpm),
        cpi: num(r.cpi),
        cps: num(r.cps),
        icvr: num(r.icvr),
        scvr: num(r.scvr),
        aov: num(r.aov),
        roas: num(r.roas),
      });
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No report rows found in this image — make sure the table (with ad names) is visible." },
        { status: 422 },
      );
    }
    return NextResponse.json({ rows, warnings });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Extraction failed" },
      { status: 500 },
    );
  }
}
