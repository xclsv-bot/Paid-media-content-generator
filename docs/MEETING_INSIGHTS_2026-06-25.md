# Meeting insights — Outlier content automation & PFL (Jun 25)

Raw distillation of the founding vision call, mapped against what's already built
(per `CREATIVE_PIPELINE.md`, `LEARNING_LOOP.md`, `PHASE3_ATTRIBUTION.md`) so the
gaps are visible as a backlog, not just notes.

## The thesis: "service as software"
Not "use AI to write ads" — build a system that **is** the service. The client
relationship becomes: dump in context weekly, review output, ship. Target
overhead once mature: **~1 hour/week** (one client call + spot-check), not a
production team. The product is the loop, not any single week's content.

## Outlier: the concrete scope
- **60 pieces/month = 15/week**, produced by a video editor + UGC creators —
  the system's job is the **written creative** (hook, format, CTA, script,
  references), not video generation. Confirmed explicitly: *"not getting the
  content created through AI, it's more so creating the prompts."*
- Seed method already validated by hand: pull past-winner reports + exported
  scripts from creative that performed well, extract the working hooks,
  generate the next batch grounded in them. This is exactly today's
  `POST /api/agent/scripts` seam + Ideate grounding — **already built**.

## The loop, as described
1. Feed in: hook, format, CTA, script, references (+ upload creative).
2. Connect Meta Ads API → know which ads perform (CPT, hook, CTA effectiveness).
3. Continuously generate + optimize the next batch from what's proven, plus
   fresh weekly insight dumps — so the month never starts from a blank page.
4. **Bank vs. slate distinction** (explicit, important): there should be a large
   *bank* of concepts to draw from, and a separate *this week* selection of the
   15 actually in production/testing — **this is the Concept-vs-Deliverable /
   Cycle split already in `CREATIVE_PIPELINE.md`**, confirmed as the right shape.
5. Stretch idea, not yet designed: pull signal from **organic** content (what
   formats work organically, beyond paid) to widen the hypothesis pool.

## Creator/editor workflow — gap identified
Two mechanisms were named for getting weekly assignments to creators/editors:
- A login where they see only their assigned work — **built** (Creator role +
  `/queue`, per `CREATIVE_PIPELINE.md` roles table).
- **Email notification on assignment — not built.** No email-sending path
  exists in the codebase today (checked for Resend/SendGrid/nodemailer — none).
  This is the concrete, scoped gap: notify a creator the moment a deliverable
  is assigned to them, instead of relying on them to check the queue.

## The flywheel argument (long tail beyond Outlier)
Explicit strategic framing: build for Outlier first, but architect so the
**insight layer generalizes** — what works for one betting/fantasy app likely
transfers to others, so more clients feeding the system compounds the quality
of everyone's output. Practical implication for this repo: org-scoping
(already RLS-enforced) needs a **cross-org, anonymized learnings layer**
eventually — proven hook/format/CTA patterns that generalize *across* clients
without leaking one client's specific scripts/cost data to another. Not
designed yet; flag before onboarding a second paying client, since "no ramp-up
period" was called out as the bar to clear (must already work well on day one
for client #2).

## Meta Ads API — confirmed priority, not yet live
Matches `LEARNING_LOOP.md`'s open item exactly: today's CSV import is the
stopgap; the ask from this meeting is the live **Marketing API** connection so
performance data (CPA/CPT, which hooks/CTAs win) flows back automatically
instead of a manual export/import cycle. No new decision here — just confirms
this is the highest-leverage next build, consistent with the existing roadmap.

## Packaging — subscription product, sold beyond sports betting
Validated framing for go-to-market (not a code change): "Outlier" is the design
partner; the same system becomes a **subscription product** for any brand
needing UGC-style paid content at volume. The case study needs to be strong
enough to sell cold — i.e., prove the loop with zero ramp-up before pitching
client #2.

## PFL / affiliate — explicitly out of scope for this system
Separate, unrelated line of business (SEO/affiliate content for a widget +
rev-share deal, not paid media creative). Explicitly deprioritized in the call
in favor of focusing on Outlier: *"doesn't make sense to take both of these
on... push back on PFL... we just want to focus on the outlier thing."*
No action needed in this repo.

## Net-new backlog items from this meeting
1. **Creator assignment email notification** — send an email when a
   deliverable is assigned (or reassigned), linking into `/queue`. Smallest,
   most concrete unbuilt ask from the call.
2. **Organic content signal** — open question, not designed: worth a follow-up
   conversation on what "scrape organic performance" would even mean as a data
   source before committing to a design.
3. **Cross-client learnings layer** — design before onboarding client #2, so
   the flywheel thesis (context compounds across clients) has somewhere to
   live without violating per-client RLS isolation.
4. **Live Meta Marketing API sync** — already tracked in `LEARNING_LOOP.md`;
   this meeting just confirms it's the priority, not a new requirement.
