-- WealthCircle — Phase 2 fix: let a group's creator see it immediately.
--
-- Bug found during live Phase 2 security testing: `groups_select_members`
-- only granted access via an existing group_memberships row
-- (is_group_member). The creator's owner membership is inserted by an
-- AFTER INSERT trigger on public.groups
-- (groups_after_insert_create_owner_membership). PostgreSQL re-checks
-- SELECT-policy visibility for rows produced by an INSERT ... RETURNING
-- clause, and does so before AFTER triggers on that same statement have
-- run — so INSERT ... RETURNING on groups always failed for the first
-- row of a brand-new group, even though the trigger would have granted
-- access moments later. This broke both a plain `.insert().select()`
-- from a client and create_group_with_setup()'s
-- `returning id into v_group_id`.
--
-- Fix: also allow a row's own creator to see it. This grants no more
-- than what the synchronous trigger already guarantees them moments
-- later as the group's owner — it only closes the RETURNING-timing gap
-- at creation, not a tenant-isolation weakening.
--
-- This migration also restores groups_insert_authenticated's real check
-- expression, which was temporarily loosened to `true` on the live
-- project while diagnosing this bug.

alter policy "groups_insert_authenticated" on public.groups
  with check (created_by = auth.uid());

alter policy "groups_select_members" on public.groups
  using (public.is_group_member(id) or created_by = auth.uid());
