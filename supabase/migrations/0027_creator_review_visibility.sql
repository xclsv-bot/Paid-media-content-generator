-- ============================================================================
-- 0027_creator_review_visibility.sql — let the assigned creator READ the
-- review feedback they must act on (audit finding B3).
-- ============================================================================
-- "Request changes" writes its reason to `comments` and its state to
-- `approvals` (ReviewCard → /api/creatives/[id]/approval + /comments), but
-- comments_read/approvals_read (0021) gate on can_see_creative() = staff OR
-- org match — and a creator's org is the XCLSV agency, never the client org,
-- so the one role that must act on the feedback could read none of it.
--
-- SELECT-only, assignment-scoped (same shape as pn_creator_read, 0020).
-- Deliberately NO insert/update for creators: replies stay in
-- production_notes (the internal thread), and approval state stays a
-- staff/client call. Policies are additive-OR — client and staff access are
-- untouched, nothing is broadened for anyone else.

create policy comments_creator_read on public.comments for select
  using (public.is_creator() and public.creator_has_concept(creative_id));

create policy approvals_creator_read on public.approvals for select
  using (public.is_creator() and public.creator_has_concept(creative_id));
