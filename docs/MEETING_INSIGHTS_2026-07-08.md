# Meeting insights — Weekly check-in: connect the loop to the UI (Jul 8)

Distillation of the Jul 8 weekly check-in (Alastair ↔ Zaire), mapped against
the codebase so the asks read as a backlog. The headline: the learning loop
(winners cache / golden set / bad-example store) is built end-to-end in code
and already grounds Ideate — but during the call the Ideate chat itself
reported all three stores **empty** ("no CPT-derived signal from last week").
The logic works; nothing feeds it.

## Where each side is

- **Frontend/workflow (Zaire)** — the weekly cycle is largely done: Ideate
  chat → content topics → briefs → assign → creator uploads video (Whisper
  transcription) → review → deliver. Creator handoff lands this weekend;
  client dashboard next. He's ideating well but the chat runs on
  slate-proven editorial flags only, because the stores are empty.
- **Backend/logic (Alastair)** — the loop layer (`src/lib/loop/*`,
  migrations 0016/0018/0019/0021): gated winner scoring, golden-set state
  machine, triple-gated loser store, daily refresh cron, Ideate/reviewer/
  scoreboard consumption. Supabase had drifted behind the code (migrations
  not applied); fixed live on the call. Root cause noted by Zaire himself:
  pushing code without DB access meant Claude "didn't know what was going on
  in the database" — the migrations are now applied and the preflight/
  post-check discipline stays.

## The client's real-world process (source of truth for signals)

- The paid team tracks ads in an **Excel sheet** keyed by the ad naming
  convention: spend, CTR, CPA per flight. They graduate on best CTR/CPA.
  This matches the shape `creative_metrics` was built for in
  `0011_report_metrics.sql` ("the naming convention is the unit of
  measurement").
- **Zaire gets live sheet access Jul 9.** The sheet becomes the metrics
  feed; naming conventions must align so rows join to `creatives.ad_name`.
- Buckets used with the client: **Graduated / Keep testing / Killed** —
  keep those labels consistent everywhere (they're already the
  `creative_metrics.verdict` labels on `/performance`).
- Iteration goal: keep generating per family/bucket until pieces hit
  **$10 CPA**, on a **weekly** review cadence (not autonomous/instant).

## The core ask: connect the logic to the UI, invisibly

Zaire, explicitly: *"I don't want winners cache / golden set / loser store to
be visible… I want the interactions the user has with the pieces of content
to store it."* And: *"connect whatever the logic is that you have for
identifying wins and losses [to the Ideate side]… once this is good, this is
the money."*

So the contract is:
1. **Recording a CPA / setting Graduated–Keep testing–Killed is the UI.**
   No dedicated curation screens (he didn't recognize `/winners` — it stays
   as a staff observability view, not a workflow step).
2. Those interactions **automatically populate the stores**, which already
   flow into Ideate; script generation should ground on the same source.
3. **Winning-video transcripts** are a first-class signal: "not only that
   this topic worked, but here's the copy that worked."

## Gap analysis (verified against the code)

1. **No data enters the loop.** `creative_performance` — the input
   `refreshAll()` reads — is a *view* over `creative_metrics` joined on
   `ad_name` (0011, re-created in 0021). Nothing in the app writes
   `creative_metrics`: no API route, and `package.json`'s
   `seed:sheet → scripts/import-sheet.ts` points at a file that doesn't
   exist. Empty input ⇒ empty stores ⇒ ungrounded ideation.
2. **Two disconnected notions of "winner".** `creative_metrics.verdict`
   (GRADUATE/KEEP_TESTING/KILL) is never computed anywhere — it only arrives
   with imported report rows — while the loop derives winners/losers from
   its own gates. Script generation
   (`/api/concepts/[id]/scripts/generate`) grounds *only* on
   `verdict='GRADUATE'` and never reads the golden set; Ideate does the
   opposite. The two must converge.
3. **No interaction-driven capture.** The only refresh triggers are the
   daily cron and a manual staff button; there is no UI to record a CPA or
   set a verdict at all.
4. **Transcripts aren't a signal.** The golden refresh snapshots the written
   script and skips winners without one; `video_assets.transcript` (what was
   actually said in the winning cut) never reaches golden examples or
   prompts.

## The build (this branch)

Verdict becomes **derived by default, overridable by the paid team**
(`creative_metrics.verdict_source: auto|user|report`): the auto value comes
from the *same* gates the loop uses (`evaluateWinner` / loser gates), so the
label can never contradict the stores; a user/report override wins inside the
loop (GRADUATE force-includes in winners cache + golden set with a
"graduated by paid team" reason; KILL writes an honest `manual_kill`
bad-example that auto-prunes if the verdict flips back).

1. **Migration 0024** — `verdict_source`, `manual_kill` kind +
   `apply_manual_kills` RPC (service-role, mirror of `apply_bad_refresh`),
   `golden_examples.transcript`.
2. **`/api/metrics` (POST)** — staff upsert of a metric row (spend,
   conversions, CPA, CTR, verdict) keyed `(ad_name, flight_label)`, then an
   **immediate `refreshAll()`** — stores populate the moment a CPA is
   recorded, not next-day. Surfaced as a small quick-entry on the creative
   detail page and an inline verdict select on `/performance`. That is the
   entire new UI surface.
3. **Loop honors overrides** (`src/lib/loop/refresh.ts`) — precedence above.
4. **Script generation grounds on the golden set + winners cache**, with the
   GRADUATE list as labeled cold-start fallback.
5. **Transcripts as signal** — the refresh snapshots the winning cut's
   transcript excerpt into each golden example; Ideate and the script writer
   quote "the winning delivery".
6. **Sheet ingestion** — `/api/metrics/import` (JSON or CSV; staff session
   or agent key) normalizing headers, parsing verdict labels as
   `verdict_source='report'`, reporting **unmatched ad names** (naming-drift
   made visible), one refresh at the end; plus the missing
   `scripts/import-sheet.ts` CLI so `npm run seed:sheet` is real. A cron
   puller waits on learning the access mechanism (Sheets API vs CSV export)
   from the Jul 9 call.

## Decisions / follow-ups for the team

- **$10 CPA target**: env change, not code — set `CPA_TARGET=10`
  (`src/lib/metrics/perf.ts`; contract default is $30). Flag: the volume
  gates (10 results / $50 spend / 20 trials, `src/lib/loop/config.ts`) were
  tuned for a $30 world — revisit for $10.
- **Jul 9 call**: get the sheet's exact column headers + a naming-convention
  sample so `/api/metrics/import`'s header map can be confirmed, and decide
  Sheets-API-pull vs weekly CSV export.
- Linear setup for shared task tracking came up; no repo impact.

## Other notes from the call (no repo action)

- Zaire may repurpose the tool as an *organic* content generator later —
  the loop's signal layer is deliberately source-agnostic (`creative_metrics`
  rows are just "performance by ad name"), so nothing blocks that.
- Intro to Brian Roth (Rocket Alumni Solutions-adjacent) being made by
  Zaire; unrelated to this codebase.
