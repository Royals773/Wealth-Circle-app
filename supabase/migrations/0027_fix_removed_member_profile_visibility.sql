-- Fixes a real, pre-existing gap found live while running PA-13
-- (member removal and reactivation) against staging.
--
-- Bug: profiles_select_self_or_groupmate (the only SELECT policy on
-- profiles besides the self-row and platform-admin ones) requires both
-- sides of the shared-group join to have status = 'active':
--
--   mine.status = 'active' AND theirs.status = 'active'
--
-- group_memberships itself has no such restriction for a manager
-- viewing their own group's roster (group_memberships_select_groupmates
-- has no status condition at all), so loadMemberDirectory()
-- (src/lib/data/member-directory.ts) correctly gets the removed
-- member's membership row back, but the accompanying profiles lookup
-- returns nothing for them the moment their status flips to 'removed'
-- or 'suspended' — the UI then falls back to "Unknown member" with a
-- blank email, and an owner/administrator has no way to identify who
-- they're looking at on the Removed/Suspended tabs, even though the
-- Reactivate action is (after the accompanying member-directory-table.tsx
-- fix) fully available and would work correctly against the right
-- user_id regardless of this display gap.
--
-- Fix: add one additive, narrowly-scoped policy granting a group's
-- owner/administrator (the same role set already authoritative for
-- remove_member/reactivate_member/suspend_member via is_group_manager())
-- read access to the profile of ANY member of a group they manage,
-- regardless of that member's current membership status. This does not
-- change who can call remove_member/reactivate_member/suspend_member —
-- those RPCs re-check is_group_manager() themselves server-side and are
-- completely unaffected by this policy, which only widens a read path.
-- It does not expose profiles to ordinary members, to managers of
-- unrelated groups, or to signed-out requests. profiles holds only id,
-- full_name, email, avatar_url, created_at, updated_at — no auth.users
-- data, no credentials.
drop policy if exists "profiles_select_managers_any_status" on public.profiles;

create policy "profiles_select_managers_any_status"
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.group_memberships gm
    where gm.user_id = profiles.id
      and public.is_group_manager(gm.group_id)
  )
);

comment on policy "profiles_select_managers_any_status" on public.profiles is
  'Lets a group owner/administrator resolve the identity of any member of a group they manage (active, suspended, or removed) — needed so the Removed/Suspended tabs on the Members page can show a real name instead of "Unknown member" and so the manager can identify who they are about to reactivate. Scoped to is_group_manager(), the same role set already authoritative for remove_member/reactivate_member/suspend_member. Ordinary tenant isolation (profiles_select_self_or_groupmate) is unchanged for every other role and every unrelated group.';
