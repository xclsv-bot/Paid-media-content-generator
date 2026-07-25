-- ============================================================================
-- 0025_creator_delete_own_upload.sql — let a creator remove an accidental
-- upload, without letting them pull published work.
-- ============================================================================
-- A creator may DELETE a video_assets row only when ALL hold:
--   * they uploaded it themselves,
--   * it belongs to a concept they're assigned to (creator_has_concept), and
--   * the concept hasn't been published — no deliverable is Approved or
--     Delivered. Once a cut is client-facing, removal is a staff call.
--
-- concept_is_published() is SECURITY DEFINER because deliverables RLS only
-- shows a creator their own assignments — another assignee's Delivered row
-- would be invisible to an inline subquery and the guard would silently pass.
-- ============================================================================

create or replace function public.concept_is_published(c_id uuid)
  returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from public.deliverables d
     where d.concept_id = c_id
       and d.production_status in ('Approved', 'Delivered')
   ) $$;

revoke execute on function public.concept_is_published(uuid) from public, anon;
grant  execute on function public.concept_is_published(uuid) to authenticated;

create policy va_creator_delete on public.video_assets for delete
  using (
    public.is_creator()
    and uploaded_by = auth.uid()
    and public.creator_has_concept(creative_id)
    and not public.concept_is_published(creative_id)
  );
