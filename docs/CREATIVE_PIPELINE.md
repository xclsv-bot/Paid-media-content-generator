# Creative Pipeline — Design (v2)

The app is evolving from a flat creative library into a **production pipeline with a
weekly heartbeat**. This doc is the agreed blueprint; it's implemented across several
PRs (this one is the data foundation).

## The spine
A creative moves through stages, and each "section" of the app is a window into one
stage, tuned to who's looking:

```
Idea  →  picked into a Cycle (the weekly 15)  →  in production (creator uploads)
      →  internal review  →  delivered  →  client approves  →  live  →  performance ↺
```

Performance winners get flagged and flow back into Ideas as proven templates.

## Two layers: Concept vs Deliverable
- **Concept** (the durable idea, lives in the Idea bank): family, hook, archetype,
  `idea_status` (Backlog / Testing / Winner / Parked), **scripts** (AI-generated,
  versioned), **references** (uploads + links), compliance. Reusable across weeks.
- **Deliverable** (a Concept scheduled into a Cycle): `assignee`, `due_date`,
  `production_status`, and the uploaded video. This is the unit of weekly work.

A proven concept can be re-dropped into a future cycle as a *new* deliverable without
duplicating the idea — that's what closes the loop.

## Cycle (the weekly drop)
A first-class object: `label` ("Week of Jun 23"), date range, `target_count` (15),
status (Planning / Active / Closed). Created manually each week; you pull ~15 concepts
into it. "This Week" = the deliverables of the active cycle.

## Scripts are AI-generated
An external agent (performance + meeting/research insight) writes scripts. The app is
the **system of record**, not the writer:
- `scripts` table is **versioned** per concept with provenance (`source` ai|human,
  `status` draft|approved, `model`, `context`).
- Secure ingestion endpoint **`POST /api/agent/scripts`** authenticated by an
  **agent API key** (`AGENT_API_KEY`) — the seam the agent plugs into.
- Humans **edit + Approve** in the Concept brief before it reaches a creator.
- References are uploaded manually (Supabase Storage `references` bucket) or linked.

## Roles
| Role | Sees | Can do |
|---|---|---|
| Admin | everything | plan cycles, assign, review, all data incl. cost |
| Editor | everything (XCLSV) | create/edit concepts, upload, set status |
| **Creator** (new) | only their assigned deliverables (current cycle) | read the brief, upload video, change production status |
| Client Viewer | delivered work + performance (own org) | watch, download, approve, comment — never cost/scripts |
| Agent (API key) | — | push AI script drafts via the ingestion endpoint |

## Screens (built in later PRs)
- **Ideas** — the bank; filter by family / hook (normalized) / archetype / idea-status; "Add to week".
- **This Week** — admin **table** of the active cycle's deliverables (concept · family · hook · assignee · due · status inline · video ✓/✗), filter chips, "X of 15".
- **Concept brief** — script (view/edit/approve) + references + compliance on the left; deliverable/video + performance on the right.
- **Creator queue** — assigned-only; open → read brief → upload → flip status.
- **Performance** — unchanged.

## Build order
1. **Foundation** (this PR): migrations (cycles, deliverables, scripts, references,
   idea_status, creator role, hook normalization) + RLS + the agent script API.
2. IA + Concept brief.
3. Cycles + This Week table.
4. Creator queue.
5. (later) Client Review tab.

## Notes
- Hook normalization seeds a `hook_angles` lookup from current distinct values so the
  filter is FK-backed; *merging* near-duplicates (e.g. "Big Win" vs "Big Win / Proof")
  is an editorial follow-up, not auto-applied.
- `video_assets` gains a nullable `deliverable_id` so an uploaded video attaches to the
  week's deliverable (while still resolving to its concept).
