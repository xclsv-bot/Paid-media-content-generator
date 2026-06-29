# Improvement Plan

A backlog of concrete, ready-to-execute improvements for this repository. Every item
was derived from a direct audit of the code on `main` (not from aspiration), and each
is written so a developer who did **not** write this plan can pick one item cold and
start immediately — without asking what to do, why, what "done" means, or whether they
can begin.

## How to read an item
- **Files** — the exact files you'll touch (with line numbers as of this writing; grep
  to re-confirm before editing).
- **Why** — what the code does today, why it was likely built that way, what's wrong
  now, and what this change fixes. This is context, not instructions.
- **Definition of done** — the acceptance criteria. When all boxes are true, the item
  is finished. Where two developers might read "done" differently, the ambiguity is
  resolved here.
- **Prerequisites** — the item(s) that must land first, if any.
- **⚠ Needs owner / needs verification** — a decision this plan deliberately does **not**
  make for you (an architecture/library/product/priority call, or a claim about the
  codebase that the author could not verify). Resolve the flag before or during the
  work; don't guess silently. A default recommendation is given where one exists so the
  item is still executable.

## Conventions used by these items
- "Staff" = an XCLSV `admin` or `editor`. Defined by `isStaff()` in `src/lib/auth.ts:28`.
- "Creator" = the restricted `creator` role added in migration `0005_add_creator_role.sql`
  (see `docs/CREATIVE_PIPELINE.md` → Roles). A creator sees and acts on **only their own
  assigned deliverables**, enforced by RLS in `0006_pipeline.sql`.
- "RLS" = Postgres row-level security. The server client (`src/lib/supabase/server.ts`)
  runs every query **as the signed-in user**, so RLS is the real authorization boundary;
  the `isStaff()` checks in route handlers are a coarse first gate in front of it.
- Migration order and current state: `0001`–`0006` exist in `supabase/migrations/`.

---

## P-1 — Sync the `AppUser.role` type with the database enum

**Files:** `src/lib/auth.ts:3-9` (the `AppUser` type), `src/lib/auth.ts:19-25`
(`getCurrentUser` casts the DB row to `AppUser`).

**Why:**
`getCurrentUser()` selects `role` from `public.users` and casts the result to `AppUser`
(`return (profile as AppUser) ?? null`). The `AppUser.role` union is
`"admin" | "editor" | "client_viewer"`. But migration `0005_add_creator_role.sql` added
a fourth value, `creator`, to the `user_role` enum, and the app already depends on it:
`src/app/this-week/page.tsx:115` queries `users` with `role in ("creator","editor","admin")`
to populate the assignee picker. So a signed-in creator's real role (`"creator"`) is
silently mistyped at the boundary. The cast was almost certainly written before the
`creator` role existed (Phase 1) and never revisited when `0005` landed. The concrete
harm: TypeScript cannot flag any `switch (user.role)` / role-equality logic that forgot
the `creator` case, because the type says that value is impossible. This is the
foundation other role-aware work (P-2, P-3) builds on, so it goes first.

**Definition of done:**
- [ ] `AppUser.role` is `"admin" | "editor" | "client_viewer" | "creator"`.
- [ ] `isStaff()` is unchanged in behavior — it must still return `false` for `creator`
      (a creator is **not** staff). Confirm with a one-line check or comment.
- [ ] `npm run typecheck` passes; no new `as AppUser`/`as any` was added to silence an
      error — if a real call site now fails to typecheck, fix the call site, don't cast.
- [ ] grep `\.role` across `src/` and confirm no existing comparison silently breaks for
      `creator`. (At the time of writing the only role logic is `isStaff()` in
      `src/lib/auth.ts:29` plus display-only uses in `AppNav.tsx`/`WeekBoard.tsx`; re-grep
      to confirm nothing new was added.)

**Prerequisites:** none. This is the prerequisite for P-2 and P-3.

---

## P-2 — Let creators upload video for their assigned concept

**Files:** `src/app/api/uploads/sign/route.ts:8-12` and `src/app/api/videos/route.ts:7-12`
(both gate on `isStaff(user)`), using `src/lib/auth.ts`.

**Why:**
Both upload endpoints reject anyone who isn't staff (`if (!isStaff(user)) return 403`).
Yet migration `0006_pipeline.sql` deliberately added RLS policies so a creator **can**
write a video for a concept assigned to them — `va_creator_write` (`0006:164-165`):
`insert ... with check (is_creator() and creator_has_concept(creative_id))` — and read it
back via `va_creator_read`. The database was built to permit exactly this; the API layer
contradicts it. The endpoints were written in Phase 1 when only staff uploaded; the
creator role and its RLS arrived later in the pipeline redesign, and the route gates were
never loosened. The result: the "Creator queue" workflow described in
`docs/CREATIVE_PIPELINE.md` (build step 4: "assigned-only … upload … flip status") is
**blocked** — a creator literally cannot get a signed upload URL. Fixing this unblocks
that screen while leaving the actual per-row authorization to RLS.

**Definition of done:**
- [ ] `POST /api/uploads/sign` and `POST /api/videos` accept a request from a `creator`
      **in addition to** staff. Use a new helper (e.g. `canUploadVideo(user)` =
      `isStaff(user) || user.role === "creator"`) rather than inlining the role check, so
      the rule lives in one place.
- [ ] Authorization for *which* creative a creator may act on is **left to RLS** — the
      route must continue to query through the user-scoped server client
      (`createClient()` from `src/lib/supabase/server.ts`), so a creator requesting a sign
      URL or registering a video for a concept that is **not** assigned to them gets a
      `Not found`/`Forbidden` outcome from the existing RLS-backed `creatives` /
      `video_assets` checks — **not** a success. Add a test or a manual verification note
      to the PR proving a creator cannot upload to an unassigned concept.
- [ ] `/api/uploads/sign`'s existing "confirm the creative exists and is visible"
      query (lines 23-31) already runs under RLS; confirm it returns 404 for a creator on
      an unassigned creative (because `creatives_creator_read` only exposes assigned
      concepts).
- [ ] Staff behavior is unchanged.

**Prerequisites:** P-1 (the helper needs `creator` in the `role` type).

---

## P-3 — Let creators advance their own deliverable's production status

**Files:** `src/app/api/deliverables/[id]/route.ts:15-47` (`PATCH`, gated on `isStaff`).

**Why:**
`PATCH /api/deliverables/:id` lets staff set `assignee_id`, `due_date`, and
`production_status`, and is gated on `isStaff()`. Migration `0006` added
`deliverables_creator_update` (`0006:142-144`): a creator may `update` a deliverable
where `assignee_id = auth.uid()`. The pipeline doc's build step 4 says a creator should
"flip status" on their assigned work. So, as with P-2, the DB permits it and the API
forbids it. The reason the change can't be a blind copy of P-2: a creator should be able
to move a deliverable **forward through production** (e.g. Assigned → In production →
Submitted) but should probably **not** be able to set the staff-review outcomes
(`Approved`, `Delivered`) or reassign the work (`assignee_id`) or change `due_date`. That
distinction is a product rule this plan does not own.

**Definition of done:**
- [ ] A `creator` may `PATCH` a deliverable assigned to them and change
      `production_status`; staff retain full access to all three fields.
- [ ] A creator may **not** change `assignee_id` or `due_date` (those stay staff-only);
      attempting to do so is rejected or ignored, not silently applied.
- [ ] A creator may **not** patch a deliverable that isn't theirs — enforced by RLS via
      the user-scoped client (the `update ... .eq("id", id)` returns zero rows for a
      non-owner, which must surface as a 404/Forbidden, not a 200 with `null`).
- [ ] The set of `production_status` values a creator may set matches the decision in the
      flag below, and invalid/over-privileged transitions are rejected with a 400/403.

**⚠ Needs owner / needs verification:** *Which* `production_status` values may a creator
set is a product decision. Recommended starting rule (confirm with the product owner):
creators may set `In production`, `Submitted`, `In revision`; `Approved` and `Delivered`
remain staff-only. The status list lives at `src/app/api/deliverables/[id]/route.ts:5-12`.

**Prerequisites:** P-1.

---

## P-4 — Make script version numbering concurrency-safe

**Files:** `src/app/api/agent/scripts/route.ts:53-61` and
`src/app/api/concepts/[id]/scripts/route.ts:24-31`. Schema:
`scripts` has `unique (concept_id, version)` (`0006_pipeline.sql:83`).

**Why:**
Both endpoints assign a new script's version by reading the current maximum and adding
one: `SELECT version ... ORDER BY version DESC LIMIT 1` then `INSERT version = max + 1`.
Because `scripts` enforces `unique (concept_id, version)`, two requests for the same
concept that interleave between the read and the insert both compute the same version,
and the second `INSERT` fails the unique constraint — surfacing as a generic
`500 { error: <pg message> }`. This read-then-increment pattern is the simplest thing
that works for a single caller and was fine for the foundation cut, but
`POST /api/agent/scripts` is explicitly the **external agent ingestion seam**
(`docs/CREATIVE_PIPELINE.md` → "Scripts are AI-generated"); an automated agent can post
several drafts in a burst, which is exactly when this races. The fix makes concurrent
posts each get a distinct sequential version instead of a 500.

**Definition of done:**
- [ ] Two concurrent `POST`s for the same concept both succeed and receive **distinct,
      sequential** version numbers (no `500` from a `23505` unique violation). Demonstrate
      either with a test that fires two inserts for one concept and asserts versions `n`
      and `n+1` (use the runner from P-6 if it has landed), or — if P-6 has not landed —
      with a documented manual demonstration in the PR. P-6 is **not** a hard prerequisite;
      the fix can ship with a manual demonstration.
- [ ] The fix is applied to **both** endpoints (the agent seam and the human-script seam),
      or both call one shared helper.
- [ ] A genuine duplicate/constraint error unrelated to the version race still returns a
      clear non-2xx (don't swallow all errors to make the race "pass").

**⚠ Needs owner / needs verification (implementation approach — pick one):**
- *Recommended (app-level, no migration):* on a `23505` unique-violation from the insert,
  re-read the max version and retry, bounded to a small number of attempts (e.g. 5).
  Lowest blast radius; keeps logic in the route/helper.
- *Alternative (DB-side):* compute the version in a `BEFORE INSERT` trigger or via a
  per-concept sequence so the database assigns it atomically. Cleaner invariant, but adds
  a migration and moves logic into SQL.

---

## P-5 — Stop silently swallowing the Meta auto-link insert error

**Files:** `src/app/api/meta/import/route.ts:82-84` (the unchecked insert) and the
response assembly at `:104-125`. Constraint:
`meta_ads` has `unique (coalesce(ad_account_id,''), ad_name)` (`0003_performance.sql:20-21`).

**Why:**
During import, ad names that auto-match a creative are inserted as new `meta_ads` links:
`if (newLinks.length > 0) { await supabase.from("meta_ads").insert(newLinks); }` — the
result is **discarded** (no `{ error }` destructure, no check). The author treated the
link insert as fire-and-forget. But the response then reports `matchedAds: linkByName.size`
and upserts insights for every name in `linkByName` — including names whose link insert
may have failed. Because `meta_ads` has a unique index on `(ad_account_id, ad_name)`, a
concurrent import (or any constraint error) can make this insert fail for some rows; those
links never persist, their daily insights silently don't attach, yet the API returns a
success payload claiming they matched. The team imports from this screen to drive the
Monday retro, so a silently-dropped link is a wrong-numbers bug, not just a log gap.

**Definition of done:**
- [ ] The `meta_ads` insert result is checked. On error, the request does **not** report
      those names as matched: either return a non-2xx with the error, or move the affected
      names into the `unmatchedAds` list so they're reported back for reconciliation.
- [ ] **Edge case — concurrent/duplicate insert:** a name that is *already linked*
      (the unique index rejects the insert because another import created it) must be
      treated as **already linked** — re-read the existing `meta_ad_id` and proceed to
      upsert its insights — **not** reported as a failure and **not** dropped. Use a
      **re-select** to recover the existing `meta_ad_id` (query `meta_ads` by ad name +
      account and read its `meta_ad_id`), rather than PostgREST `upsert`'s `onConflict`:
      the unique index here is **functional** — `(coalesce(ad_account_id,''), ad_name)`
      (`0003:20-21`) — so a column-name `onConflict: "ad_account_id,ad_name"` does not
      reliably target it (unlike the plain `(meta_ad_id, date)` constraint the insights
      upsert uses). The re-select approach sidesteps that ambiguity.
- [ ] `matchedAds` / `upserted` in the response count only links/rows that actually
      persisted.
- [ ] Apply the same "don't crash on an expected duplicate" treatment to
      `POST /api/meta/link` (`src/app/api/meta/link/route.ts:24-39`), which today does a
      bare `.insert(...)` against the same unique index and will `500` if a staffer links
      a name that's already linked. Return a clear "already linked" response instead of a
      raw Postgres error.

**Prerequisites:** none.

---

## P-6 — Add a test runner and unit tests for the parse + performance math

**Files (new tests):** `src/lib/meta/csv.ts` (`parseMetaCsv` and its number/date
normalizers) and `src/lib/meta/perf.ts` (`isHit`, `rollupBy`, `defaultTargetCents`).
**Files (config):** `package.json` (add a `test` script), `.github/workflows/ci.yml`
(run it).

**Why:**
`lib/meta/csv.ts` normalizes Meta exports — strips `$`, `,`, `%`, parses `M/D/YYYY` and
ISO dates, and converts CTR from a percent (`2.67`) to a ratio (`0.0267`).
`lib/meta/perf.ts` computes CPT and CTR as **ratio-of-sums** (`sum(spend)/sum(results)`,
deliberately *not* the average of per-creative ratios) and decides `Hit? = CPT ≤ target`.
These functions produce the numbers the team optimizes spend against. PR #3 states the
"CSV parser unit-checked against a realistic Meta export" and the math was "ratio-of-sums
… the correct way to aggregate" — but **no test files are committed** (none exist under
`src/`), and CI (`.github/workflows/ci.yml`) runs only `typecheck` + `build`. So any
regression in this money math ships green. Adding a runner + tests turns the claimed
checks into enforced ones.

**Definition of done:**
- [ ] A `test` script exists in `package.json` and CI runs it on every PR (add a step to
      `.github/workflows/ci.yml` after `typecheck`).
- [ ] `parseMetaCsv` tests cover, at minimum: a value with `$` + thousands comma (e.g.
      `"$1,234.50"` → `1234.5`); a `%` value; both `M/D/YYYY` and `YYYY-MM-DD` dates map to
      `YYYY-MM-DD`; a row missing ad name or date is **skipped** (counted in `skipped`, not
      emitted); CTR `2.67` parses to `0.0267`; a header-alias variant (e.g. `Amount spent`
      vs `Amount spent (USD)`) is detected; the `resultsColumn` override selects a custom
      column.
- [ ] `perf.ts` tests cover: `rollupBy` returns **ratio-of-sums** and a worked example
      where ratio-of-sums ≠ average-of-ratios (so a regression to averaging fails the
      test); `cpt`/`ctr` are `null` when the denominator (`results`/`impressions`) is `0`;
      `isHit` returns `null` when either CPT or target is missing, `true` at exactly the
      target boundary (`cpt == target`), and `false` above it.
- [ ] All tests pass locally and in CI.

**⚠ Needs owner / needs verification (library choice):** pick the test runner.
Recommended default: **Vitest** (zero-config with TypeScript/ESM, fast, widely used with
Next.js). Acceptable alternatives: Node's built-in `node:test` (no new dependency) or
Jest. This is a one-time architectural choice for the repo — confirm it before adding the
dependency, since it sets the pattern all future tests follow.

---

## P-7 — Enforce the single-active-cycle invariant atomically

**Files:** `src/app/api/cycles/[id]/route.ts:22-39`. Related read assumption:
`src/app/this-week/page.tsx` ("This Week" = the one active cycle).

**Why:**
Activating a cycle runs **two separate statements**: first
`update cycles set status='Closed' where status='Active' and id != :id`, then
`update cycles set status='Active' where id=:id`. There is no transaction and no DB-level
constraint guaranteeing at most one `Active` row. The "demote then promote" approach reads
naturally and works for a single careful user, which is the case it was written for. But
two near-simultaneous activations (or a failure/timeout between the two statements) can
leave **zero or two** cycles `Active`. "This Week" assumes exactly one active cycle, so
violating the invariant shows the wrong week or none. The fix makes "exactly one active
cycle" a guarantee rather than a convention.

**Definition of done:**
- [ ] It is impossible to end up with two `Active` cycles, even under concurrent
      `PATCH ... { status: "Active" }` requests. Demonstrate the invariant holds (a test or
      a documented reasoning about the chosen mechanism).
- [ ] Re-activating the cycle that is **already** `Active` is a no-op success, not an
      error.
- [ ] Setting a cycle to `Planning`/`Closed` still works and does not affect other cycles.

**⚠ Needs owner / needs verification (implementation approach — pick one):**
- *Recommended:* add a partial unique index in a new migration —
  `create unique index cycles_one_active on public.cycles (status) where status = 'Active';`
  — then perform the demote+promote inside a single transaction/RPC (or order the writes
  and handle the unique violation by retrying the demote). The index makes a double-active
  state physically impossible.
- *Alternative:* a `SECURITY DEFINER` RPC that does both updates atomically.
  Verify any new migration is purely additive and safe to apply to the live DB (it follows
  `0006`).

---

## P-8 — Restrict reference uploads to an allowed file-type set

**Files:** `src/app/api/references/sign/route.ts:13-25` and the bucket definition
`supabase/migrations/0006_pipeline.sql:101-103`.

**Why:**
`POST /api/references/sign` accepts any `fileName`, sanitizes it to a storage key, and
mints a signed upload URL into the private `references` bucket. That bucket is created with
a 500 MB size limit but **no `allowed_mime_types`** (contrast the `creative-videos` bucket
in `0002_storage.sql:18-22`, which restricts to `video/mp4|quicktime|webm`). References are
later served back through `createSignedReferenceView` (`src/lib/storage.ts:65-75`), which
returns an **inline** (not forced-download) signed URL. So a staffer can upload an
arbitrary file type — including `.html`/`.svg` — that is then served inline from the
storage domain, a stored-content risk. The references feature was added quickly to attach
"PDFs, clips, images"; the type restriction the video bucket got was never applied here.

**Definition of done:**
- [ ] Reference uploads are restricted to an explicit allow-list of content types,
      enforced server-side (validate before signing in `references/sign`, and/or set
      `allowed_mime_types` on the `references` bucket via a new additive migration).
- [ ] A disallowed type is rejected with a clear 400 before any signed URL is minted.
- [ ] Allowed types are documented next to the endpoint.

**⚠ Needs owner / needs verification (the allow-list contents):** which file types the
team actually needs to attach as references is a product call. Recommended starting list to
confirm: `application/pdf`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`,
`video/mp4`, `video/quicktime`. Explicitly decide whether `image/svg+xml` is allowed
(it can carry script and is served inline — recommend **excluding** it).

**Prerequisites:** none.

---

## Out of scope / explicitly deferred
These were considered during the audit and intentionally left out so each item above stays
focused. Promote them to full items only with an owner's go-ahead:
- **Rate-limiting / request-size caps** on `POST /api/agent/scripts` and
  `POST /api/meta/import` (both parse an unbounded JSON body). ⚠ Needs owner — this is a
  priority/risk-acceptance call, not a clear-cut defect.
- **Migrating the 6 legacy Google Drive video links into the bucket** (noted in
  `docs/SETUP.md` → "Not yet done"). ⚠ Needs verification — depends on access to those
  Drive files, which is outside this repo.
- **Comments / approvals UI** (tables + RLS already exist per PR #1) — a feature, not a
  hardening item.
