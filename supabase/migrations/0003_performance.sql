-- ============================================================================
-- 0003_performance.sql — Meta performance rollups (Phase 2)
-- ============================================================================
-- Adds:
--   * a per-creative CPT target (with a global env fallback in the app),
--   * an idempotency key on meta_ads so CSV re-imports don't duplicate links,
--   * a creative_performance view that sums the daily insights per creative.
--
-- IMPORTANT: CPT is computed as ratio-of-sums — sum(spend)/sum(results) — NOT
-- the average of per-day CPTs. Averaging ratios is wrong and would quietly skew
-- the Monday-retro numbers.
-- ============================================================================

-- Per-creative CPT target (cents). Null => fall back to the app's global default.
alter table public.creatives
  add column if not exists cpt_target_cents integer;

-- Idempotent ad linking: one row per ad name per account. Lets imports upsert.
-- (Single-client today, but account-scoped so multi-account later is safe.)
create unique index if not exists meta_ads_account_name_uniq
  on public.meta_ads (coalesce(ad_account_id, ''), ad_name);

-- One row per creative with summed metrics. security_invoker => the caller's RLS
-- on the underlying tables applies, so a client only ever sees its own creatives.
create or replace view public.creative_performance
with (security_invoker = on) as
select
  c.id                                   as creative_id,
  coalesce(sum(i.spend), 0)              as spend,
  coalesce(sum(i.impressions), 0)        as impressions,
  coalesce(sum(i.clicks), 0)             as clicks,
  coalesce(sum(i.results), 0)            as results,
  case when coalesce(sum(i.impressions), 0) > 0
       then sum(i.clicks)::numeric / sum(i.impressions)
       else null end                     as ctr,
  case when coalesce(sum(i.results), 0) > 0
       then sum(i.spend)::numeric / sum(i.results)
       else null end                     as cpt,
  max(i.fetched_at)                      as last_updated,
  min(i.date)                            as first_date,
  max(i.date)                            as last_date
from public.creatives c
left join public.meta_ads a            on a.creative_id = c.id
left join public.meta_insights_daily i on i.meta_ad_id = a.meta_ad_id
group by c.id;
