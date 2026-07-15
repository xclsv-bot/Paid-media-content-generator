-- ============================================================================
-- 0030_winner_breakdowns.sql — structural teardowns of winning content.
-- ============================================================================
-- The golden set carries WHAT won (the verbatim script + transcript excerpt);
-- a winner_breakdown carries WHY it worked, decomposed by an analyst model into
-- reusable structure: hook mechanics, beats, proof device, CTA, delivery
-- rationale, the replicable pattern, and what to vary next. Ideate and script
-- generation ground on these so new concepts build on the pattern behind a
-- winner instead of its truncated raw text.
--
-- Two ways a creative earns a breakdown (`source`):
--   * performance — it is in the golden set (CPT-gated or GRADUATE-forced).
--   * editorial   — staff marked idea_status='Winner' on the concept; there is
--     no gated performance evidence, and every consumer labels it as such.
--
-- Lifecycle: rows are written ONLY by the service-role refresher
-- (src/lib/loop/breakdowns-refresh.ts) — no user write path, no curation state
-- machine, hence no RPC (contrast apply_golden_refresh, which exists to protect
-- pinned/removed rows). A creative that leaves the winner set is soft-
-- deactivated (status='inactive'), not deleted: if it re-enters with the same
-- script + transcript (input_hash match) the cached breakdown reactivates
-- without a new model call.
--
-- input_hash keys staleness: sha256 over script_version | script | transcript |
-- dimensions. Metrics (cpt/results) are deliberately NOT hashed — they drift on
-- every refresh and only update the snapshot columns, never force a re-analysis.
-- ============================================================================

create table public.winner_breakdowns (
  creative_id    uuid primary key references public.creatives (id) on delete cascade,
  org_id         uuid not null references public.organizations (id),
  source         text not null check (source in ('performance', 'editorial')),
  status         text not null default 'active' check (status in ('active', 'inactive')),
  breakdown      jsonb not null,
  -- dimension snapshot at generation time (same contract as golden_examples:
  -- keys are mandatory, values may be null when the creative lacks metadata)
  dimensions     jsonb not null,
  model          text not null,
  script_version integer,
  input_hash     text not null,
  -- metric rationale snapshot at generation time (null for editorial picks)
  why_it_won     text,
  cpt_cents      integer,
  results        integer,
  target_cents   integer,
  generated_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint wb_hash_nonempty check (length(btrim(input_hash)) > 0),
  constraint wb_breakdown_keys check (
    breakdown ?& array['hook', 'beats', 'proof_device', 'cta', 'delivery', 'replicable_pattern', 'vary_next']
  ),
  -- ?& alone would accept a top-level ARRAY of the seven key names (array
  -- elements count as matches) and any value shapes; pin the container types
  -- the readers dereference. Full validation stays in parseBreakdown — the
  -- readers also re-validate, so one malformed row can never 500 a page.
  constraint wb_breakdown_shapes check (
    jsonb_typeof(breakdown) = 'object'
    and jsonb_typeof(breakdown -> 'hook') = 'object'
    and jsonb_typeof(breakdown -> 'beats') = 'array'
    and jsonb_typeof(breakdown -> 'cta') = 'object'
    and jsonb_typeof(breakdown -> 'delivery') = 'object'
    and jsonb_typeof(breakdown -> 'vary_next') = 'array'
  ),
  constraint wb_dimensions_keys check (
    dimensions ?& array['family', 'hook_line', 'hook_angle', 'archetype', 'sport', 'format']
  )
);
create index on public.winner_breakdowns (org_id, status);

alter table public.winner_breakdowns enable row level security;

-- Staff manage everything; creators may read active breakdowns for orgs they
-- are actively producing for (same rationale AND same assignment-based scope
-- as ge_creator_read after 0024 — creators belong to the agency org, so the
-- creator_in_org() predicate is what stops one client's teardowns leaking to
-- another client's contractor). No client policy: the teardown is derived from
-- internal scripts. All writes happen on the service-role client (the
-- refresher), which bypasses RLS — like content_cache.
create policy wb_staff_all on public.winner_breakdowns for all
  using (public.is_staff()) with check (public.is_staff());
create policy wb_creator_read on public.winner_breakdowns for select
  using (public.is_creator() and status = 'active' and public.creator_in_org(org_id));
