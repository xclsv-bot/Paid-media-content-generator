# Audit — User-Blocking Dead Ends in Three Flows

**Date:** 2026-07-10
**Scope:** Three named flows —
1. **Discoverability** of learnings/winners from **Ideate** and **This Week**
2. **Creator path:** Queue → upload → status flip
3. **Empty / error states:** Ideate with no learnings, Winners with empty cache

**What this doc is:** a record of *where a user gets stuck* — a state where they cannot
proceed, or cannot locate a feature without insider knowledge. It does **not** propose a
redesign. Where a fix seems obvious, that is flagged as a **separate design decision**, not
a recommendation made here.

**Method:** five passes, each walking the least-covered flow to find its single biggest
undocumented dead end, then re-walking. Findings are ordered by pass.

**Severity scale**
- **Blocking** — the user genuinely cannot proceed; no path forward from the current screen.
- **High** — the user cannot locate the feature without insider knowledge, or an action fails
  silently / misleadingly so the user can't tell what to do next.
- **Medium** — recoverable, but the path is ambiguous or unsignalled and a reasonable user
  will believe they are done / stuck when they are not.

**Role note (applies throughout):** "staff" = admin/editor on the agency org
(`isStaff`, `src/lib/auth.ts:39`). Ideate, This Week, Winners, Performance, Review are all
staff-only (`requireStaff` + the `(staff)` route group, `src/app/(staff)/layout.tsx`).
Creators (`role: "creator"`) can only reach `/queue` and `/creatives/[id]`; their nav is a
single "My Queue" link (`src/components/AppNav.tsx:21-22`). Clients never see any of these.
So Flow 1 (discoverability) and Flow 3 (empty/error) are **staff** experiences; Flow 2 is a
**creator** experience.

---

## Pass 1 — Flow 1 (discoverability) · Finding A1

### Learnings are unreachable from Ideate and This Week — they exist only at the bottom of Performance

**Severity: High** (cannot locate the feature without insider knowledge)

**Repro path**
1. Sign in as staff. Go to **Ideate** (`/ideate`).
2. Brainstorm concepts. Look for the "current learnings" (the Do-more / Do-less / Watch-out
   guidance) that is supposed to steer the next round of creative.
3. There is no link, panel, button, or hint to them anywhere on Ideate.
4. Repeat on **This Week** (`/this-week`) — same result.

**Observed state**
- The "Current learnings" panel (`LearningsPanel`, `src/components/LearningsPanel.tsx`) is
  rendered in exactly one place: the **bottom of the Performance page**
  (`src/app/(staff)/performance/page.tsx:338`, after the full verdict tables and the rollups).
- Ideate **does** consume learnings — silently. The API injects them into the model's system
  prompt via `learningsPromptBlock(await latestLearnings(...))`
  (`src/app/api/ideate/route.ts:136,159`), but nothing about that grounding is shown to the
  user. From the UI there is no indication learnings exist, are current, or feed the agent.
- This Week has no learnings surface at all.
- To read learnings a staff user must already know to: navigate to **Performance**, ensure the
  correct org is selected, scroll past the entire weekly report, and find the panel at the
  very bottom. That is insider knowledge.

**Why it's a dead end:** the stated flow is "discover learnings/winners from Ideate and This
Week." From either of those two screens the learnings feature is not discoverable — there is
no path to it and no sign it exists.

**Fix is a separate design decision** (e.g., surfacing a learnings summary or link on Ideate/
This Week) — out of scope for this doc.

---

## Pass 2 — Flow 2 (creator path) · Finding B1

### An empty creator queue is a guidance-less dead end — the one hint that exists is hidden from creators

**Severity: Blocking** (creator has nowhere to go and no explanation)

**Repro path**
1. Sign in as a **creator** (`role: "creator"`) who has no deliverables assigned (fresh
   creator, or all their work removed from cycles).
2. Land on **My Queue** (`/queue`) — this is the creator's home (`homeFor`, `src/lib/auth.ts:50`).

**Observed state**
- The page shows a single line: **"Nothing assigned to you yet."**
  (`src/app/queue/page.tsx:79-88`).
- The only follow-up guidance — a pointer to This Week explaining where assignments happen —
  is explicitly gated to **non-creators**: `{user.role !== "creator" && ( … This Week … )}`
  (`src/app/queue/page.tsx:82`). So the creator, the exact person on this page, does **not**
  see it. (And This Week is staff-only anyway, so the hint would 404-bounce them — but they
  never get it.)
- The creator's global nav is a single link, "My Queue" (`src/components/AppNav.tsx:21-22`),
  which points back to the same empty page.

**Why it's a dead end:** a creator with an empty queue has: one nav link (to the page they're
already on), no CTA, no explanation, and no way to tell whether they're supposed to wait, whether
the app is broken, or whether they mis-signed-in. There is literally no next action available
on the screen.

**Fix is a separate design decision** (empty-state copy telling the creator work is assigned
elsewhere and to wait) — out of scope.

---

## Pass 3 — Flow 3 (empty/error) · Finding C1  (+ verified non-issue C2)

### Winners with an empty cache: "Refresh cache" is a silent no-op with a misleading "Cached 0" and no diagnosis

**Severity: High** (staff follow the documented steps and still see nothing, with no signal why)

**Repro path**
1. Sign in as staff. Go to **Winners** (`/winners`) with an empty `content_cache` (fresh
   install, or nothing has cleared the proven bar).
2. Read the empty-state instruction and follow it: "Import the weekly report on Performance,
   then hit Refresh cache." (`src/app/(staff)/winners/page.tsx:113-118`).
3. Click **Refresh cache** (`WinnersRefresh`, `src/components/WinnersRefresh.tsx`).

**Observed state**
- Refresh reports `Cached ${body.cached} of ${body.evaluated} evaluated.`
  (`src/components/WinnersRefresh.tsx:19`).
- If no creative qualifies, the message is **"Cached 0 of N evaluated."** and the page still
  shows **"No winners cached yet."** The user did exactly what they were told and the screen
  is unchanged, with no explanation.
- The three outcomes are **indistinguishable to the user**:
  - **(a) No performance imported at all** → `evaluated = 0` → "Cached 0 of 0 evaluated."
    The refresh loops over creatives that have a `creative_performance` row and `continue`s past
    those with none (`src/lib/loop/refresh.ts:48-49`); with no perf rows, nothing is evaluated.
  - **(b) Reports imported but nothing cleared the Hit + volume gates** → "Cached 0 of N
    evaluated." (N > 0). The winners bar is `evaluateWinner` (`src/lib/loop/refresh.ts:85`),
    which requires volume, not just a Hit — a legitimately empty but correct result.
  - **(c) A real read/write failure** → surfaced as an error string, but the copy
    ("Refresh failed") doesn't tell the user whether to retry, re-import, or wait.
- Nothing on the screen tells the user which of (a)/(b)/(c) they are in, or what to do next.
  The documented recovery ("import, then refresh") has already been exhausted.

**Why it's a dead end:** the empty-cache state is *supposed* to be the recoverable one, but
after following the on-screen recovery the user is back to "No winners cached yet" with a
"Cached 0" toast and no way to diagnose the cause or find the next step. (Note: the empty
cache is correctly signalled to the *agent* via `EMPTY_CACHE_NOTE`,
`src/lib/loop/winners-cache.ts:26` — the dead end is in the **human** UI, not the grounding.)

**Fix is a separate design decision** — out of scope.

### C2 (verified — NOT a dead end): "Ideate with no learnings"

Walked and confirmed **safe**, so a checker doesn't flag it as missing:
- With no learnings for the org, `latestLearnings(...)` returns null and
  `learningsPromptBlock(null)` returns an empty string
  (`src/app/api/ideate/route.ts:136,159`). The agent simply omits that block; the Ideate chat
  works normally and the user sees no error and no degraded state.
- Likewise, no winners / no golden / no bad examples each render an explicit sentinel to the
  **model** (`EMPTY_CACHE_NOTE`, the golden "(golden set is empty…)" line at
  `src/app/api/ideate/route.ts:122`, `EMPTY_BAD_NOTE`), never a crash.
- **Conclusion:** Ideate-with-no-learnings degrades gracefully. It is not a user-blocking dead
  end. (The genuinely-blocking Ideate empty state is *no client org* — see Finding C3, Pass 5.)

---

## Pass 4 — Flow 1 (discoverability, re-walk) · Finding A2

### This Week "Proven" portfolio slots are dead affordances, and there is no path from This Week to Winners

**Severity: High** (a visible control does nothing; the winner it implies is unreachable from here)

**Repro path**
1. Sign in as staff. Go to **This Week** (`/this-week`) for a cycle whose org has at least one
   proven family (so the "Portfolio slots" strip renders).
2. In the "Portfolio slots" strip, note the family chips: **Proven** (emerald), **Validating**
   (amber), **Untested** (grey).
3. Click a **Proven** chip expecting to reach the proven winner/example behind it.

**Observed state**
- **Validating** and **Untested** chips are links (`<Link href="/ideate">`), styled with a
  hover border, that route to Ideate to fill the slot
  (`src/app/(staff)/this-week/page.tsx:165-174`).
- **Proven** chips are rendered as a **non-clickable `<span>`**
  (`src/app/(staff)/this-week/page.tsx:161-164`). They sit in the same row, same pill shape,
  same size as the clickable chips, but clicking one does nothing — no navigation, no popover,
  no detail. The only extra info is a `title` tooltip with the cohort CPT.
- There is **no link to Winners** (`/winners`) anywhere on This Week, and none to the specific
  proven creative. The Portfolio slots know a family is "Proven · N/M hit" but offer no route
  to see *which* creative won or its script.
- Winners is reachable only from the global top nav, not from this contextual strip.

**Why it's a dead end:** the Proven chip looks identical to its clickable neighbours, so a user
reasonably clicks it to "see the proven winner" and gets nothing (dead affordance). More
broadly, from This Week there is no path into the winners/learnings the strip is summarizing —
the discoverability the flow requires is absent.

**Related (same flow):** Ideate likewise has **no link to Winners** and no "what's winning"
surface — winners are consumed only as hidden grounding
(`getCachedWinners`, `src/app/api/ideate/route.ts:92,112`). Winners is reachable from the global
nav, but never from the Ideate context where the user is actually reasoning about them.

**Fix is a separate design decision** — out of scope.

---

## Pass 5 — Flow 2 & Flow 3 (tie, re-walk) · Findings B2 and C3

### B2 — Uploading a cut never flips the deliverable status, and nothing tells the creator to submit

**Severity: Medium** (recoverable, but a reasonable creator believes they're done and the hand-off signal is never given)

**Repro path**
1. Sign in as a creator with an assigned deliverable. Open **My Queue** (`/queue`).
2. In the deliverable card, use **"Upload a video"** (`VideoUploader`,
   `src/components/VideoUploader.tsx`); wait for "Done."
3. Consider the work handed off. Do nothing else.

**Observed state**
- Upload registers the video and calls `router.refresh()` — but it does **not** change the
  deliverable's `production_status` (`src/components/VideoUploader.tsx:69-71`). Status stays
  whatever it was: "Assigned" (the default a deliverable is created with) or "In production".
- The status is a **separate manual control**: `DeliverableStatusSelect`
  (`src/components/DeliverableStatusSelect.tsx`), a dropdown the creator must independently
  change to "Submitted". A creator whose deliverable is still "Assigned" sees that value shown
  as a **disabled** option (`src/components/DeliverableStatusSelect.tsx:50-52`) — they can pick
  "In production / Submitted / In revision" (`CREATOR_STATUSES`, `src/lib/deliverables.ts:15`),
  but nothing on the page prompts them to, or explains that uploading ≠ submitting.
- **Consequence split (important for the checker):**
  - Staff **Review** keys on *video presence*, not status — "Only show delivered work (has at
    least one video)" (`src/app/(staff)/review/page.tsx:71-72`). So the uploaded cut **does**
    appear in Review even if status was never flipped. Review is therefore *not* blocked.
  - But the **This Week board** tracks the deliverable by `production_status`
    (`WeekBoard`, `src/components/WeekBoard.tsx:316`). It will show the row with a green "video ✓"
    (`WeekBoard.tsx:320`) yet a status of "Assigned"/"In production" — so anyone managing the
    week by status column reads it as *not submitted*, while the video is in fact ready.
  - "Approved" and "Delivered" are staff-only, and "Delivered" is what gates the client portal
    (`src/lib/deliverables.ts:12-15`) — none of which the creator can reach, correctly.

**Why it's a dead end (soft):** the creator can complete the flow, but nothing signals that the
status flip is a required, separate step after upload. A creator who uploads and stops has, from
their point of view, finished — while the status the week-board relies on still says otherwise,
and no confirmation of hand-off is ever shown.

**Design opinion flagged:** whether upload should auto-advance status, or whether the two should
stay decoupled, is a **design decision, not made here**. This doc only records that the required
step is currently unsignalled.

### C3 — Ideate with no client org: the Send button silently no-ops

**Severity: Blocking** (the primary action does nothing, with no error)

**Repro path**
1. Reach a state with **no non-agency organization** (fresh install seeded with only the agency
   org, or before any client org exists).
2. Sign in as staff, go to **Ideate** (`/ideate`).
3. Type a message and press **Send** (or Enter).

**Observed state**
- The org `<select>` is populated from non-agency orgs only
  (`is_agency = false`, `src/app/(staff)/ideate/page.tsx:11-15`). With none, the list is empty
  and `orgId` initializes to `""` (`src/components/IdeateWorkspace.tsx:48`).
- `send()` begins with `if (!text || busy || !orgId) return;`
  (`src/components/IdeateWorkspace.tsx:138`) — so with `orgId === ""` it **returns immediately
  and silently**. No request is sent, no message appears, no error, no toast. The composer just
  sits there.
- The API would reject it too (`"org_id is required"`, `src/app/api/ideate/route.ts:72-74`),
  but the client-side guard means that error is never even surfaced.

**Why it's a dead end:** the one action on the page (Send) produces no visible effect and no
explanation. A user cannot tell whether the app is broken, whether their message was sent, or
that the real blocker is "no client org exists." This is the genuinely-blocking Ideate empty
state (as distinct from the harmless "no learnings" case in C2).

**Fix is a separate design decision** — out of scope.

---

## Checker pass — Finding B3 (surfaced by the independent runner)

### The creator cannot see the reviewer's change-request feedback — revision instructions are written to a store no creator-facing screen renders

**Severity: High** (the role that must act on the request is the only one with no surface showing it — insider/out-of-band knowledge required to proceed)

This finding was not in the first five passes; the independent checker surfaced it, and it is
verified true against the code. It sits in Flow 2, in the **revision loop** that follows
queue → upload → status flip, and is distinct from B1 (empty queue) and B2 (unsignalled flip).

**Repro path**
1. Creator uploads a cut and sets status to "Submitted."
2. Staff open **Review** (`/review`), click **"Request changes"** and type the reason in the
   comment box (`src/components/ReviewCard.tsx:84-86` for the button, `:108-119` for the box).
   Staff separately flip the deliverable's `production_status` to "In revision" on This Week.
3. Creator returns to **My Queue** and clicks **Open brief** (`/creatives/[id]`) to find out
   what to fix.

**Observed state**
- "Request changes" sets the approval state via `POST /api/creatives/[id]/approval`
  (`src/components/ReviewCard.tsx:39-42`), and the typed reason is written to the **`comments`**
  table via `POST /api/creatives/[id]/comments`
  (`src/components/ReviewCard.tsx:60-63` → `src/app/api/creatives/[id]/comments/route.ts:22`).
- The `comments` table is read on the staff **Review** page (`src/app/(staff)/review/page.tsx:44`)
  and on the **client** portal (`src/lib/client/data.ts:28`, with approval state at
  `src/lib/client/data.ts:111`). Both staff and client can read the feedback.
- The **creator's** own concept page loads **`production_notes`** for the DiscussionThread
  (`src/app/creatives/[id]/page.tsx:71-77`) — a *different* table — and never queries
  `comments` or the `approvals` state. My Queue shows only `production_status`
  (`DeliverableStatusSelect`), and the concept page's status pills are `idea_status` /
  `creative.status`, neither of which is the review approval state.
- Net: the creator sees a bare "In revision" with **no reason, no reviewer comment, and no
  approval state** anywhere they can reach.

**Why it's a dead end:** the person who must act on "Request changes" is the only role with no
surface showing the change request — while both staff and the client can read it. The revision
loop can only proceed via out-of-band communication (Slack/email) or a staff member manually
re-typing the note into the separate DiscussionThread. It is High rather than Blocking only
because the creator can still re-upload a blind guess.

**Fix is a separate design decision** — out of scope.

---

## Coverage summary (for the independent checker)

Walk each flow using only this doc; every state below should already be recorded.

| Flow | State walked | Finding | Severity | Dead end? |
|---|---|---|---|---|
| 1. Discoverability | Learnings from Ideate / This Week | **A1** | High | Yes — unreachable except via bottom of Performance |
| 1. Discoverability | Winners from This Week ("Proven" slot) + from Ideate | **A2** | High | Yes — dead chip; no contextual path to Winners |
| 2. Creator path | Empty queue | **B1** | Blocking | Yes — no CTA, hint hidden from creators |
| 2. Creator path | Upload → status flip | **B2** | Medium | Soft — flip is required but unsignalled (design opinion flagged) |
| 2. Creator path | Revision loop (change request) | **B3** | High | Yes — reviewer feedback written to a store the creator's screens never render |
| 3. Empty/error | Winners empty cache + refresh | **C1** | High | Yes — no-op + misleading "Cached 0", no diagnosis |
| 3. Empty/error | Ideate with no learnings | **C2** | — | No — degrades gracefully (verified) |
| 3. Empty/error | Ideate with no client org | **C3** | Blocking | Yes — Send silently no-ops |

If the checker walks all three flows against this table and finds a **blocking** state not
listed, that is a gap in this doc and should be reported.
