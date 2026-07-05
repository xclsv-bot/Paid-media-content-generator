# Phase 3 — State & Attribution (the outer loop's "learn" edge)

Turns matured 21-day CPT verdicts into **structured, reusable learnings** that feed
back into the reviewer rubric and Ideate — so the engine gets smarter each cycle.
Builds on the Learning Loop design (`docs/LEARNING_LOOP.md`).

## Locked decisions
- **Maturity / "set live" date = first-spend date (proxy).** A creative's go-live
  is the first day it recorded Meta spend (`creative_performance.first_date`). A
  cohort is **mature** when `today − first_date ≥ 21 days` (the contract window).
  No migration; works with existing data. (Can add an explicit `set_live_at`
  later if we need more precision.)
- **Confidence bar = ≥ ~20 trials behind a creative** before it counts toward
  learnings (avoids small-sample noise). Configurable via env
  (`LOOP_MIN_TRIALS`, default 20).
- **Surface = the Performance page.** The scoreboard + cycle learnings render as
  new sections there — no new nav item.

## Sub-steps (build in order)

### 3a — Scoreboard (deterministic attribution) — build first
Pure math, no AI, high-trust. Over **mature** creatives with **≥20 trials**, group
by each dimension and compute CPT (ratio-of-sums), **hit-rate** (% at/under the
$30 target), trials, and spend:

- Dimensions: **family · hook angle · audience (archetype) · sport · feature · format**
- Reuses `rollupBy` + `creative_performance`; **no new table** for 3a.
- Renders on the Performance page ("what's winning, by dimension").
- Feeds **Ideate** (replace/augment the raw top/bottom lists with the digested
  per-dimension scoreboard) and the **reviewer rubric** (angle_fit scored against
  what's actually winning).

### 3b — `cycle_learnings` (agent attribution)
An analyst agent reads the scoreboard + the winning/losing **scripts** and writes a
structured narrative: what's working, what's missing, do-more / do-less, with a
confidence note. Persisted; injected into the reviewer prompt + Ideate grounding.

- New table `cycle_learnings` (cycle_id, generated_at, narrative, attribution
  jsonb, confidence, model).
- Human-approve before it influences generation (start in-the-loop).

### 3c — Portfolio / slot tracker
Track each family/format's status (**proven / validating / parked**) with its
evidence (trials, hit-rate, CPT), and **graduate** formats that clear the bar.
Drives explore/exploit allocation in This Week (the "find ~10 formats" objective;
Wildcard stays the ~15% R&D lane).

- Either a small `format_slots` table or status + evidence on `concept_families`.

### 3d — Heartbeat (schedule) — build last
The weekly job: Meta sync → find newly matured cohorts → scoreboard → learnings →
update slots → alert. Only automate after 3a–3c are proven by hand (per the
build-order rule). Candidate runners: a Vercel cron hitting an endpoint, or an
Anthropic Managed Agent on a schedule.

## Attribution method & caveats
- **Deterministic first (3a), narrative second (3b).** The math is the ground
  truth; the agent explains *why* and proposes actions — it never overrides the
  numbers.
- **Maturity + confidence gate everything** — only mature cohorts, only creatives
  with ≥20 trials, count. Everything else is "still learning."
- **CPT = ratio-of-sums** (`sum(spend)/sum(results)`), never an average of
  per-creative CPTs — already enforced in `rollupBy` / `creative_performance`.
- **Small samples still lie.** Express confidence bands; accumulate across weeks;
  don't graduate a format on one lucky cohort.

## Feedback wiring (how state closes the loop)
- **→ Ideate:** swap the raw top/bottom lists for the digested scoreboard +
  latest `cycle_learnings` so it reasons from conclusions, not raw rows.
- **→ Reviewer rubric:** inject the current learnings so `angle_fit` and scoring
  reflect what's winning right now.
- **→ This Week:** the slot tracker guides which families to exploit vs explore.

## Open items
- Env: `LOOP_MIN_TRIALS` (default 20).
- Exact scoreboard layout on the Performance page.
- Autonomy per step (start human-approve for learnings + graduation).
