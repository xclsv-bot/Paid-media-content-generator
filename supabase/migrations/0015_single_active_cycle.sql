-- 0007_single_active_cycle.sql
-- Enforce "at most one Active cycle PER CLIENT ORG" at the database level.
--
-- PATCH /api/cycles/:id activates a cycle by demoting any other Active cycle in
-- the same org and then promoting this one — two statements with no transaction,
-- so a race could otherwise leave zero or two Active cycles for that org. The
-- "This Week" view assumes exactly one active cycle per client. This partial
-- unique index makes a double-active state impossible within an org while still
-- letting different clients each have their own Active cycle; the route retries
-- on the resulting unique violation.
--
-- Additive and safe to apply after 0006. If a single org somehow already has two
-- Active cycles, demote the extras before applying (see git history for the
-- one-off query).
create unique index if not exists cycles_one_active
  on public.cycles (client_org)
  where status = 'Active';
