-- ============================================================================
-- 0011_report_metrics.sql — replace Meta integration with report-based metrics.
-- ============================================================================
-- We no longer pull from the Meta API. The team sends a weekly report (a sheet)
-- keyed by AD NAME — the naming convention is the unit of measurement. This
-- stores those rows and repoints creative_performance to read from them, joined
-- to creatives by ad_name. Multiple creatives can share a name (same creative
-- "type"); they all reflect that name's performance — by design.
-- ============================================================================

-- ---------- report metrics (one row per ad name per flight/week) ----------
create table public.creative_metrics (
  id           uuid primary key default gen_random_uuid(),
  ad_name      text not null,
  flight_label text not null default 'default',   -- e.g. 'Week of Jun 22'
  flight_start date,
  -- judging columns
  spend        numeric,       -- flight spend
  conversions  integer,
  cpa          numeric,       -- cost per conversion (= our CPT); report Flight CPA
  ctr          numeric,       -- stored as a ratio (0-1)
  bau_cpa      numeric,       -- benchmark the verdict is judged against
  verdict      text,          -- 'GRADUATE' | 'KEEP_TESTING' | 'KILL'
  reason       text,
  -- funnel columns (from the report's top table)
  cpm          numeric,
  cpi          numeric,
  cps          numeric,
  icvr         numeric,       -- ratio (0-1)
  scvr         numeric,       -- ratio (0-1)
  aov          numeric,
  roas         numeric,
  created_at   timestamptz not null default now(),
  unique (ad_name, flight_label)
);
create index on public.creative_metrics (ad_name);

alter table public.creative_metrics enable row level security;

-- Staff manage. Clients/creators may read metrics for a name attached to a
-- creative they're allowed to see (the naming convention is the join).
create policy cm_staff_all on public.creative_metrics for all
  using (public.is_staff()) with check (public.is_staff());
create policy cm_read on public.creative_metrics for select using (
  exists (
    select 1 from public.creatives c
    where c.ad_name = creative_metrics.ad_name
      and (
        c.client_org = public.current_org()
        or (public.is_creator() and public.creator_has_concept(c.id))
      )
  )
);

-- ---------- repoint creative_performance at the report metrics ----------
-- Same column shape the app already reads (creative_id, spend, impressions,
-- clicks, results, ctr, cpt, last_updated, first_date, last_date); impressions/
-- clicks are absent from the report, so null. security_invoker => the caller's
-- RLS on creatives + creative_metrics applies.
drop view if exists public.creative_performance;
create view public.creative_performance
with (security_invoker = on) as
select
  c.id                                       as creative_id,
  coalesce(sum(m.spend), 0)                  as spend,
  null::bigint                               as impressions,
  null::bigint                               as clicks,
  coalesce(sum(m.conversions), 0)::bigint    as results,
  avg(m.ctr)                                 as ctr,
  case when coalesce(sum(m.conversions), 0) > 0
       then sum(m.spend)::numeric / sum(m.conversions)
       else null end                         as cpt,
  max(m.created_at)                          as last_updated,
  min(m.flight_start)                        as first_date,
  max(m.flight_start)                        as last_date
from public.creatives c
left join public.creative_metrics m on m.ad_name = c.ad_name
group by c.id;

-- ---------- drop the Meta integration tables ----------
drop table if exists public.meta_insights_daily;
drop table if exists public.meta_ads;
