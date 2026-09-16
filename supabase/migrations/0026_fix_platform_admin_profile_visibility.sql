-- Fixes a real, pre-existing gap found live while running PA-05
-- (organiser-application approval) against staging.
--
-- Bug: 0024_phase10_platform_authorisation.sql added
-- groups_select_platform_admins, organiser_applications_select_platform_admins
-- and audit_logs_select_platform_admins — each "a second, independent
-- read path for platform admins" alongside the normal tenant-scoped
-- policies, so the /platform-admin review screens can see data outside
-- the admin's own group memberships. profiles never received the
-- matching policy. The only existing SELECT policy on profiles,
-- profiles_select_self_or_groupmate, only allows a viewer to see their
-- own row or a row belonging to someone they share an active group
-- with. A platform admin reviewing an organiser application from
-- someone they don't already share a group with — the common case for
-- a first-time applicant — gets zero rows back from the identity join
-- in loadOrganiserApplicationsByStatus() (src/lib/data/platform-admin.ts),
-- not an error, so the UI silently renders "Unnamed" with a blank
-- email. The same gap affects loadPendingGroupReviews() and
-- loadActiveGroupsForModeration()'s owner-email lookups in the same
-- file, via the identical pattern.
--
-- Fix: add the one missing policy, following the exact template already
-- used for groups/organiser_applications/audit_logs. profiles holds
-- only id, full_name, email, avatar_url, created_at, updated_at — no
-- auth.users data, no credentials — so this exposes nothing beyond
-- what the app already treats as shareable identity, to platform
-- admins only. Purely additive: existing self-or-groupmate visibility
-- for every other role is unchanged. Scoped explicitly `to authenticated`
-- (unlike the three existing sibling policies, which apply to every
-- role including anon) so an anonymous request never even evaluates
-- this policy's USING clause.
drop policy if exists "profiles_select_platform_admins" on public.profiles;

create policy "profiles_select_platform_admins"
on public.profiles
for select
to authenticated
using (public.is_platform_admin());

comment on policy "profiles_select_platform_admins" on public.profiles is
  'Lets allowlisted platform administrators resolve applicant/group-owner identity (full name, email) when reviewing organiser applications and groups, independent of shared group membership. Ordinary tenant isolation (profiles_select_self_or_groupmate) is unchanged for every other role.';
