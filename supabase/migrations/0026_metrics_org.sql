-- ============================================================================
-- 0026_metrics_org.sql — creative_metrics gets a real org_id.
-- ============================================================================
-- Until now the report rows had NO org column; consumers scoped them by
-- joining ad_name to the org's concepts. Two failures fell out of that:
--   * an imported row whose name doesn't match a concept yet (naming-format
--     drift, typo, not-yet-created concept) was invisible on Performance,
--   * ad names aren't org-namespaced, so two clients minting the identical
--     convention name would share (and overwrite) one metrics row.
-- Stamp the org at import time instead. The unique key becomes
-- (org_id, ad_name, flight_label) so clients can never collide.
-- ============================================================================

alter table public.creative_metrics
  add column org_id uuid references public.organizations (id);

-- All existing rows belong to the only client org.
update public.creative_metrics
   set org_id = '99999999-9999-9999-9999-999999999992';
alter table public.creative_metrics alter column org_id set not null;

-- Re-key the upsert conflict target per org.
alter table public.creative_metrics
  drop constraint creative_metrics_ad_name_flight_label_key;
alter table public.creative_metrics
  add constraint creative_metrics_org_ad_flight_key unique (org_id, ad_name, flight_label);
create index on public.creative_metrics (org_id);
