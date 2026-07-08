-- ============================================================================
-- 0024_org_scope_creator_example_reads.sql — close the cross-tenant read left
-- open on the example stores, without blanking them out for creators.
-- ============================================================================
-- Problem: ge_creator_read / be_creator_read (0018/0019) let ANY creator read
-- EVERY org's winning/losing script bodies and compliance-rejection reasons.
--
-- The naive fix — `org_id = current_org()` — doesn't work here: creators are
-- members of the XCLSV agency org, while example rows carry the CLIENT org,
-- so that predicate hides everything from every creator (ci/golden_tests.sql
-- asserts a creator DOES see non-removed examples). The correct scope is
-- assignment-based: a creator may read the example stores of orgs they are
-- actively producing for.
--
-- creator_in_org() must be SECURITY DEFINER: policies evaluate subqueries as
-- the calling user, and creators cannot SELECT creatives directly, so an
-- inline join would return nothing under RLS. Mirrors creator_has_concept().
-- ============================================================================

create or replace function public.creator_in_org(org uuid)
  returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1
     from public.deliverables d
     join public.creatives c on c.id = d.concept_id
     where d.assignee_id = auth.uid()
       and c.org_id = org
   ) $$;

-- Same grant posture as the other RLS helpers (0004/0007 hardening).
revoke execute on function public.creator_in_org(uuid) from public, anon;
grant  execute on function public.creator_in_org(uuid) to authenticated;

drop policy ge_creator_read on public.golden_examples;
create policy ge_creator_read on public.golden_examples for select
  using (public.is_creator() and status <> 'removed' and public.creator_in_org(org_id));

drop policy be_creator_read on public.bad_examples;
create policy be_creator_read on public.bad_examples for select
  using (public.is_creator() and public.creator_in_org(org_id));

-- learnings_creator_read (0021) has the same latent flaw: it was "tightened"
-- to org_id = current_org(), but a creator's org is the agency, so the policy
-- actually shows creators NO learnings at all. Re-point it at the same
-- assignment-based scope.
drop policy learnings_creator_read on public.learnings;
create policy learnings_creator_read on public.learnings for select
  using (public.is_creator() and public.creator_in_org(org_id));
