-- WealthCircle — Phase 2 fix: ambiguous column reference in
-- accept_invitation().
--
-- Bug found during live Phase 2 security testing: accept_invitation()
-- declares `returns table (group_id uuid, role text)`, which makes
-- `group_id` and `role` implicit PL/pgSQL variables in scope for the
-- entire function body — not just the final `return query`. The
-- membership-existence check used an unqualified `group_id` inside a
-- `where` clause against public.group_memberships, which PostgreSQL
-- could not resolve between the table column and the output variable
-- (error 42702, "column reference \"group_id\" is ambiguous"), so
-- accept_invitation() failed for every caller. Fixed by qualifying the
-- column with a table alias.

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

  if exists (
    select 1 from public.group_memberships gm
    where gm.group_id = v_invitation.group_id and gm.user_id = v_uid
  ) then
    raise exception 'You are already a member of this group.';
  end if;

  insert into public.group_memberships (group_id, user_id, role, status)
  values (v_invitation.group_id, v_uid, v_invitation.role, 'active');

  update public.group_invitations
  set status = 'accepted', accepted_at = timezone('utc', now()), accepted_by = v_uid
  where id = v_invitation.id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_invitation.group_id, v_uid, 'invitation_accepted', 'group_invitations', v_invitation.id,
    jsonb_build_object('role', v_invitation.role)
  );

  return query select v_invitation.group_id, v_invitation.role;
end;
$$;

grant execute on function public.accept_invitation(text) to authenticated;
