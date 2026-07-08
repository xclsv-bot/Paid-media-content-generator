-- ============================================================================
-- 0024_org_scope_creator_example_reads.sql — close the cross-tenant read left
-- open on the example stores.
-- ============================================================================
-- 0021 tightened learnings_creator_read to `org_id = current_org()` but left
-- the sibling creator policies on golden_examples / bad_examples unscoped, so
-- any creator could read every org's winning/losing script bodies and
-- compliance-rejection reasons. Scope both to the creator's own org, matching
-- learnings_creator_read.
-- ============================================================================

drop policy ge_creator_read on public.golden_examples;
create policy ge_creator_read on public.golden_examples for select
  using (public.is_creator() and status <> 'removed' and org_id = public.current_org());

drop policy be_creator_read on public.bad_examples;
create policy be_creator_read on public.bad_examples for select
  using (public.is_creator() and org_id = public.current_org());
