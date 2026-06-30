-- ============================================================================
-- 0005_add_creator_role.sql
-- ============================================================================
-- Adds the restricted 'creator' role. Kept in its OWN migration because a newly
-- added enum value cannot be used in the same transaction that adds it; the
-- pipeline migration (0006) references 'creator' and must run afterward.
-- ============================================================================

alter type user_role add value if not exists 'creator';
