-- 0007_single_active_cycle.sql
-- Enforce "at most one Active cycle" at the database level.
--
-- PATCH /api/cycles/:id activates a cycle by demoting any other Active cycle and
-- then promoting this one — two separate statements with no transaction, so a
-- race (or a failure between them) could leave zero or two Active cycles. The
-- "This Week" view assumes exactly one. This partial unique index makes a
-- double-active state physically impossible; the route retries on the resulting
-- unique violation.
--
-- Additive and safe to apply after 0006. If the live table somehow already has
-- two Active cycles, demote the extras before applying:
--   update public.cycles set status = 'Closed'
--   where status = 'Active'
--     and id <> (select id from public.cycles where status = 'Active'
--                order by starts_on desc limit 1);
create unique index if not exists cycles_one_active
  on public.cycles (status)
  where status = 'Active';
