-- Closes a real gap found in Phase 7's member offboarding: a removed
-- member had no way back into the same group at all.
--
-- reactivate_member() only accepted 'suspended' members. accept_invitation()
-- checked for *any* existing group_memberships row for that
-- (group_id, user_id) pair, regardless of status, and raised "You are
-- already a member of this group" — so even sending a fresh invitation
-- to a removed member's email could never actually let them back in,
-- since their old 'removed' row (removal is a soft status change, not
-- a delete) always triggered that check.
--
-- Two fixes:
--   1. reactivate_member() now also accepts 'removed' members, for a
--      manager who wants to bring someone back directly without a new
--      invitation round-trip.
--   2. accept_invitation() now reactivates an existing 'removed' row
--      in place (rather than trying to insert a second row, which
--      would violate group_memberships' unique (group_id, user_id)
--      constraint anyway) instead of blocking the invitation.
--
-- In both paths, rejoining after removal resets joined_at to the
-- reactivation moment — a removed member's tenure genuinely restarts,
-- unlike a suspended member (who was only ever paused, never gone, so
-- their original joined_at still correctly anchors which contribution
-- periods they were responsible for). This matters concretely:
-- member_has_overdue_contributions() and similar period-based checks
-- key off joined_at, and a member who left two years ago shouldn't be
-- treated as newly overdue for every period since their original join.

create or replace function public.reactivate_member(
  p_group_id uuid,
  p_member_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_group_manager(p_group_id) then
    raise exception 'Only owners and administrators can reactivate members';
  end if;
  if p_member_id = v_uid then
    raise exception 'You cannot reactivate your own membership';
  end if;

  select role, status into v_role, v_status
  from public.group_memberships
  where group_id = p_group_id and user_id = p_member_id
  for update;

  if v_role is null then
    raise exception 'Member not found in this group';
  end if;
  if v_status not in ('suspended', 'removed') then
    raise exception 'Only a suspended or removed member can be reactivated';
  end if;

  update public.group_memberships
  set status = 'active',
      joined_at = case when v_status = 'removed' then timezone('utc', now()) else joined_at end
  where group_id = p_group_id and user_id = p_member_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'member_reactivated', 'group_memberships', p_member_id,
    jsonb_build_object('reason', p_reason, 'previous_status', v_status));
end;
$$;

grant execute on function public.reactivate_member(uuid, uuid, text) to authenticated;

create or replace function public.accept_invitation(p_token text)
returns table (group_id uuid, role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user_email text;
  v_invitation public.group_invitations%rowtype;
  v_token_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_group_name text;
  v_existing_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invitation
  from public.group_invitations
  where token_hash = v_token_hash
  for update;

  if not found then
    raise exception 'This invitation is invalid.';
  end if;

  if v_invitation.status = 'accepted' then
    raise exception 'This invitation has already been used.';
  end if;

  if v_invitation.status = 'revoked' then
    raise exception 'This invitation has been revoked.';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'This invitation is no longer available.';
  end if;

  if v_invitation.expires_at < timezone('utc', now()) then
    update public.group_invitations set status = 'expired' where id = v_invitation.id;
    raise exception 'This invitation has expired.';
  end if;

  select email into v_user_email from auth.users where id = v_uid;

  if v_user_email is null or lower(v_user_email) <> lower(v_invitation.email) then
    raise exception 'This invitation was sent to a different email address.';
  end if;

  select gm.status into v_existing_status
  from public.group_memberships gm
  where gm.group_id = v_invitation.group_id and gm.user_id = v_uid
  for update;

  if v_existing_status is not null and v_existing_status <> 'removed' then
    raise exception 'You are already a member of this group.';
  end if;

  if v_existing_status = 'removed' then
    update public.group_memberships
    set status = 'active', role = v_invitation.role, joined_at = timezone('utc', now())
    where group_memberships.group_id = v_invitation.group_id and user_id = v_uid;
  else
    insert into public.group_memberships (group_id, user_id, role, status)
    values (v_invitation.group_id, v_uid, v_invitation.role, 'active');
  end if;

  update public.group_invitations
  set status = 'accepted', accepted_at = timezone('utc', now()), accepted_by = v_uid
  where id = v_invitation.id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_invitation.group_id, v_uid, 'invitation_accepted', 'group_invitations', v_invitation.id,
    jsonb_build_object('role', v_invitation.role, 'rejoined', v_existing_status = 'removed')
  );

  select name into v_group_name from public.groups where id = v_invitation.group_id;
  perform public.create_notification(
    v_invitation.invited_by, v_invitation.group_id, 'invitation', 'invitation_accepted',
    'Your invitation to ' || v_invitation.email || ' was accepted in ' || coalesce(v_group_name, 'your group'),
    v_invitation.email || ' has joined ' || coalesce(v_group_name, 'your group') || ' as ' || v_invitation.role || '.',
    'group_invitations', v_invitation.id, 'invitation_accepted:' || v_invitation.id
  );

  return query select v_invitation.group_id, v_invitation.role;
end;
$$;

grant execute on function public.accept_invitation(text) to authenticated;
