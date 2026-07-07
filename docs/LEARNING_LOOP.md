# The Learning Loop — content engine design

How we turn the content engine from "generate → ship → hope" into a **closed
loop** that reliably produces winning creative and gets smarter every week.
This is the design; it ships in phases (see Build order). Nothing here is
autonomous until a manual run is proven first.

## The goal is contractual, so the verifier is real
A loop is only real if something *external and objective* can reject bad output
(otherwise the agent grades its own homework). Our Performance Standard defines
that gate precisely:

- **Gate:** a Creative "wins" when its **CPT ≤ Target CPT ($30.00)**, blended
  app+web trials from Meta Ads Manager, **measured 21 days after go-live**.
- **Weekly standard (the floor):** **≥ 20%** of a week's delivered Creatives
  clear the gate within their 21-day window.
- **Exclusions:** Meta-rejected/restricted Creatives and client-paused ones are
  not assessed.
- **Calibration:** first **14 days** = learning only; the standard doesn't apply.
- Target CPT is revisable monthly → keep it configurable (`META_CPT_TARGET`,
  default $30 in code).

Two consequences drive the whole design:
1. **The verdict is delayed 21 days.** So we verify at two speeds (below).
2. **20% is a floor to always clear — not the thing we optimize.** What we
   actually optimize is a *portfolio of proven, diverse formats* (below).

## Two nested loops + a mid-flight monitor
CPT can't be measured before spend, so we can't gate scripts on CPT directly.
We nest two loops around a proxy and correct the proxy against reality.

### Inner loop — Script quality (fast, cheap, pre-spend)
The article's self-checking loop, applied to scripts. Runs before any media $.
- **Maker:** a writer agent drafts the script (this is the existing
  `POST /api/agent/scripts` seam / Ideate).
- **Checker:** a *separate, stricter* reviewer agent scores it against a
  **rubric** — strong hook in the first 3s, matches a currently-winning angle,
  respects the family's compliance note, fits format/length.
- **Iterate** until it clears the bar, or stop (N revisions / token cap).
- **Verifier = the rubric (a proxy).** Cheap. Keeps obviously-weak scripts from
  ever reaching production.

### Mid-flight monitor (daily, once live)
Between shipping and the 21-day verdict, pull Meta daily and watch **leading
indicators**: CPT-so-far trajectory, thumbstop / 3-sec hook rate, CTR, spend
pace. Use them to **react before day 21** — pause a clear dog, and **push-notify**
on: "cohort trending to miss target," "Creative got Meta-rejected" (an exclusion,
but you want to know), "a format just crossed into proven."

### Outer loop — Performance learning (slow, expensive, post-verdict)
- At day 21 the cohort matures → CPT verdict lands.
- **Attribute** winners/losers to the variables we already store: family, hook
  angle, archetype (audience), sport, feature/pillar, format, CTA, script
  structure.
- Write **state**: a `cycle_learnings` record + per-family / per-angle rolling
  performance, with **confidence gated on minimum trials/spend** (small samples
  lie — a 3-conversion "winner" is noise).
- **Feed state back** into the inner loop's rubric and into Ideate's grounding.

The point of the nesting: the inner loop optimizes a **proxy** (rubric); the
outer loop **corrects the proxy against real CPT**. That's what stops the
reviewer agent from drifting into self-referential taste — the failure the
article calls the "Ralph Wiggum loop."

## The objective: a portfolio of proven, diverse formats — not repetition
We do **not** want the loop making more of the same winner. We want it to
*discover and validate a set of distinct winning formats/families*, and keep
experimenting in the slots that aren't filled. Our slate already encodes this:

| Slot type | Families | Loop role |
|---|---|---|
| **Proven** (exploit) | Parlay · Don't Use (#1 scaler) · Big Win · How-To · Gamescript | Keep producing — satisfy the 20% floor + revenue; variant, don't repeat verbatim |
| **Unproven — validate** (explore) | Stop Betting Blind · One App/Consolidation · Data Edge · Build a Process · Demystify · EV/Pro | Run controlled tests to graduate them to Proven |
| **Wildcard** (R&D) | Wildcard | Steady ~15% budget for genuinely new angles; winners graduate next cycle |

Mechanics:
- **Objective = validate K distinct formats** (target ~10; 5 already proven), each
  cleared with enough trials to be *confident*, not lucky.
- **Floor as a constraint:** every week must still clear ≥20% — so keep enough
  proven creative live while exploring.
- **Slot graduation:** a validated format joins the proven rotation; its explore
  budget redistributes to still-empty slots. Even after 2 fill, the other 8 keep
  experimenting.
- **Diversity guard:** each exploration must differ meaningfully (hook / angle /
  format / structure) from what's been tried — the loop refuses near-duplicates.
- **Compliance is a hard rule, per family:** e.g. Don't Use = attack the *method*,
  never name a competitor without written sign-off; Big Win = show the process
  behind the win (ROI-guarantee rule); EV/Pro = never lead with EV in broad
  acquisition. These live in the reviewer rubric as blockers.

## Building blocks (the article's five) — where we stand
| Block | Status |
|---|---|
| **Verifier (gate)** | CPT ≤ $30 @ 21d — *contractually defined*; attribution + confidence logic to build |
| **Connectors (act, not suggest)** | **Built** — app writes scripts, assigns in This Week, ingests Meta |
| **Skill (reusable instructions)** | To build — the script rubric + learnings-extraction prompt |
| **Maker/checker sub-agents** | To build — writer + strict reviewer split |
| **Heartbeat (automation)** | To build — weekly generation cycle + daily Meta pull |
| **State** | To build — `cycle_learnings` + per-family/angle rolling scores |

## Meta Marketing API (enables real-time + alerts)
Today performance ingests by **CSV import**. Real-time needs the **Marketing API**
(daily insights pull). The team is provisioning access; the app needs:
- `META_SYSTEM_USER_TOKEN` (long-lived system-user token), `META_AD_ACCOUNT_ID`
  (`act_…`), `META_API_VERSION`. (Placeholders already in `.env.example`.)
- **Join key:** we already store `ad_name` / `meta_ad_id` on creatives + a
  `meta_ads` table — so insights map back to concepts automatically.
- A scheduled **sync** pulls per-ad insights (spend, impressions, clicks, CTR,
  results/trials, cost-per-result) into `meta_insights_daily`, from which the
  existing rollups compute CPT + Hit. Daily cadence feeds the mid-flight monitor.

## Cost discipline (so the loop pays for itself)
- The metric that matters: **cost per accepted script** (inner) and **cost per
  proven winner** (outer) — not tokens spent. Track the AI-script **accept rate**
  (approved vs discarded). Below ~50% accept, tune the rubric before scaling.
- **Hard stops on everything:** iteration caps on the inner loop, a token/$ budget
  per cycle, cheap model on the boring steps, strict reviewer only where it pays.
- No silent runaway: the reviewer + real CPT are the gates; never let the writer
  self-declare "done."

## Build order (prove by hand → skill → gated loop → schedule)
Do **not** schedule an autonomous agent before a manual run is reliable.

1. **Now.** ✅ Target CPT set to $30. Run a cycle mostly by hand; let one 21-day
   window resolve. Codify what a "winning script" looks like.
2. **Inner loop.** Reviewer agent + rubric in the Concept brief (maker/checker,
   in-app). Cheap, no ad spend — highest immediate value.
3. **State + attribution.** `cycle_learnings` + per-family/angle scores + the
   Meta API sync feeding leading indicators.
4. **Outer loop + alerts.** Attribution → learnings → back into the rubric &
   Ideate; push notifications on the mid-flight signals.
5. **Schedule (heartbeat).** Weekly generation + daily pull, once 1–4 are proven.

**The 14-day calibration is the window to stand this up in "shadow mode"** — no
Performance Credit is at stake, so we build state and prove the gates before they
count.

## Loop thresholds (all env-overridable; single source: `src/lib/loop/config.ts`)

| env | default | gate it controls |
|---|---|---|
| `WINNER_MIN_RESULTS` | 10 | trials before a Hit's CPT is trusted → Winners Cache |
| `WINNER_MIN_SPEND_CENTS` | 5000 | spend before a Hit's CPT is trusted → Winners Cache |
| `LOOP_MIN_TRIALS` | 20 | trials before a cohort counts in the learnings scoreboard |
| `LOOP_PROVEN_HIT_RATE` | 0.5 | hit-rate for a family slot to count as Proven |
| `GOLDEN_MAX` | 10 | auto golden examples kept per refresh (pins excluded) |
| `BAD_MAX` | 10 | proven losers kept per refresh (worst first) |
| `LOSER_MATURE_DAYS` | 21 | maturity window before a proven-loser verdict |
| `LOSER_MIN_RESULTS` | =`LOOP_MIN_TRIALS` | trials before a proven-loser verdict |
| `LOSER_CPT_MULTIPLIER` | 1.5 | CPT must be ≥ this × target to be a proven loser |

> **Deliberate asymmetry (flagged, unresolved):** winners are volume-gated but
> **not** maturity-gated — a high-volume creative can enter the Winners Cache
> (and thus the Golden Set) before its 21-day window closes, while a loser
> verdict always waits for maturity. Rationale: exploit early, condemn
> carefully. Revisit if an early "winner" later misses its matured verdict.

## Open decisions
- Exact **rubric** contents (hook rules, per-family compliance blockers, structure).
- **Portfolio K** and how much weekly volume goes explore vs exploit (default
  ~15% Wildcard per the seed; propose ~70/30 exploit/explore overall).
- **Alert channel** for push notifications (email / Slack / in-app).
- Autonomy level per phase (human-approve vs auto) — start human-in-the-loop.
