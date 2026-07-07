-- ============================================================================
-- 0022_org_scope_shared_tables.sql — org-scope concept_families and hook_angles.
--
-- These were "global" tables (no org column), which an earlier design (the
-- organic_signals migration, 0012) assumed made them safe generic vocabulary.
-- In practice they are NOT client-neutral: concept_families rows contain the
-- client's literal name, real campaign $ figures, and (in compliance_note)
-- named competitors and named staff members' in-flight legal negotiations.
-- Org-scoping them closes the actual contamination surface: once a second
-- client exists, Ideate/the learnings generator must stop mixing one client's
-- family narrative/compliance notes into another's grounding.
-- ============================================================================

alter table public.concept_families add column org_id uuid references public.organizations (id);
update public.concept_families set org_id = '99999999-9999-9999-9999-999999999992'; -- outlier — all existing rows
alter table public.concept_families alter column org_id set not null;
alter table public.concept_families drop constraint concept_families_name_key;
alter table public.concept_families add constraint concept_families_org_id_name_key unique (org_id, name);
create index on public.concept_families (org_id);

alter table public.hook_angles add column org_id uuid references public.organizations (id);
update public.hook_angles set org_id = '99999999-9999-9999-9999-999999999992'; -- outlier — all existing rows
alter table public.hook_angles alter column org_id set not null;
alter table public.hook_angles drop constraint hook_angles_name_key;
alter table public.hook_angles add constraint hook_angles_org_id_name_key unique (org_id, name);
create index on public.hook_angles (org_id);

-- Both read policies previously let ANY authenticated user (including a
-- client_viewer/creator belonging to a DIFFERENT org) read every family/angle
-- row — harmless with one org, a direct leak of another client's
-- proven_hook_formula/compliance_note once a second org exists.
drop policy cf_read on public.concept_families;
create policy cf_read on public.concept_families for select
  using (public.is_staff() or org_id = public.current_org());

drop policy ha_read on public.hook_angles;
create policy ha_read on public.hook_angles for select
  using (public.is_staff() or org_id = public.current_org());

-- organic_signals stays global/unscoped by design (deliberately client-agnostic
-- market intelligence, staff-only RLS already) — its optional concept_family_id/
-- hook_angle_id FKs still resolve fine since staff have blanket visibility.
