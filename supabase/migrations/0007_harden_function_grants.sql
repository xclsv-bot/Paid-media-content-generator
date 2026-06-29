-- ============================================================================
-- 0007_harden_function_grants.sql
-- ============================================================================
-- The RLS helper functions are SECURITY DEFINER and were callable by PUBLIC
-- (hence anon) via the REST RPC endpoint — flagged by the security advisor
-- (lint 0028). They only need to be callable by signed-in users, since RLS
-- policies evaluate them as the querying role. Revoke from PUBLIC/anon and grant
-- explicitly to authenticated.
--
-- Earlier revokes (0004/0006) targeted `anon` directly but left the implicit
-- PUBLIC grant in place, so the functions stayed reachable. Revoking from PUBLIC
-- is what actually closes the anon RPC path.
-- ============================================================================

revoke execute on function public.is_staff()                  from public, anon;
revoke execute on function public.current_org()               from public, anon;
revoke execute on function public.can_see_creative(uuid)      from public, anon;
revoke execute on function public.is_creator()                from public, anon;
revoke execute on function public.creator_has_concept(uuid)   from public, anon;

grant execute on function public.is_staff()                   to authenticated;
grant execute on function public.current_org()                to authenticated;
grant execute on function public.can_see_creative(uuid)       to authenticated;
grant execute on function public.is_creator()                 to authenticated;
grant execute on function public.creator_has_concept(uuid)    to authenticated;
