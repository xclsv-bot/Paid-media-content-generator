-- ============================================================================
-- 0018_cross_client_patterns.sql — the actual cross-client sharing mechanism
-- (Phase B). A staff-authored, abstracted pattern surface — deliberately NOT
-- a broadened RLS policy on learnings/concept_families (see 0015/0016's
-- rationale: those tables carry real client IP/$/named-people content).
--
-- What must NOT be storable here is enforced by which columns exist, not by
-- staff discipline: no script/body column, no numeric/currency column, and
-- the only identity-bearing field (source_org_id) is structurally excluded
-- from the read path that builds Ideate grounding (see src/lib/loop/
-- crossClientPatterns.ts). Length caps guard against pasting a whole
-- script/transcript into a field that does exist.
-- ============================================================================

create table public.cross_client_patterns (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  pattern_type         text not null default 'hook',    -- 'hook'|'family_archetype'|'cta'|'structure' — free text, matches organic_signals.platform convention
  generalized_summary  text not null,                    -- the abstracted, client-neutral insight
  why_it_works         text,                              -- abstracted reasoning — still no $/names/scripts
  applicable_archetype archetype_type,                    -- reuses the existing enum (generalizes by construction)
  applicable_vertical  text,                               -- a CATEGORY (e.g. 'sports betting / fantasy apps'), never a client/competitor name
  source_org_id        uuid references public.organizations (id),  -- provenance for staff audit ONLY — never read by the Ideate prompt-block formatter
  authored_by          uuid not null references public.users (id),
  status               text not null default 'draft',     -- 'draft'|'published'|'archived', mirrors organic_signals.review_status
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ccp_title_len   check (char_length(title) <= 120),
  constraint ccp_summary_len check (char_length(generalized_summary) <= 500),
  constraint ccp_why_len     check (why_it_works is null or char_length(why_it_works) <= 500)
);
create index on public.cross_client_patterns (status);
create index on public.cross_client_patterns (source_org_id);

alter table public.cross_client_patterns enable row level security;

-- Staff already have blanket cross-org visibility everywhere else in this
-- schema, so this table's RLS has exactly one job: keep this internal agency
-- asset out of client and creator hands entirely — staff-only, full stop, no
-- client_viewer/creator policy of any kind (matches creative_financials'
-- posture). Do NOT add a source_org_id-based read restriction for staff.
create policy ccp_staff_all on public.cross_client_patterns for all
  using (public.is_staff()) with check (public.is_staff());
