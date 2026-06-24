-- ============================================================================
-- 0004_security_hardening.sql
-- ============================================================================
-- Tightens SECURITY DEFINER helper exposure flagged by the Supabase linter
-- (lints 0028/0029). The helpers are used inside RLS policies, so they must stay
-- callable by `authenticated` — but anon doesn't need them, the unused
-- current_role() can go, and the trigger function should not be RPC-callable.
-- ============================================================================

-- current_role() was unused (no policy references it) and collides with the
-- reserved SQL keyword. Drop it.
drop function if exists public.current_role();

-- handle_new_user() is a trigger fired by the auth system; never call it via RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- is_staff(), current_org(), can_see_creative() stay executable by `authenticated`
-- because RLS policies invoke them at query time (they only ever reveal the
-- calling user's own role/org/visibility). Remove anon's direct access.
revoke execute on function public.is_staff()             from anon;
revoke execute on function public.current_org()          from anon;
revoke execute on function public.can_see_creative(uuid) from anon;
