-- WealthCircle — Phase 2 functions
--
-- Adds the atomic, tightly-scoped database functions Phase 2 needs:
-- creating a group with its initial setup in one transaction, and the
-- invitation lifecycle (create / preview / accept / revoke).
--
-- Every function below sets `search_path = ''` and fully qualifies every
-- object it touches (including extension functions), which is the
-- Postgres/Supabase-recommended defence against search-path hijacking in
-- SECURITY DEFINER functions. Three of the five are SECURITY INVOKER —
-- they run as the calling user and rely entirely on the RLS policies from
-- 0001_init.sql for authorisation; they exist only to make a multi-step
-- operation atomic and to attach an audit log entry, not to bypass RLS.
-- Only public.get_invitation_preview() and public.accept_invitation() are
-- SECURITY DEFINER, because both must read or write across the RLS
-- boundary for a person who is not yet (or not visibly) a group member —
-- each is narrowly scoped to a single, validated operation, never a
-- general-purpose bypass.

-- pgcrypto provides gen_random_bytes()/digest(), used for invitation
-- token hashing. Supabase-provisioned projects pre-install pgcrypto in
-- the `extensions` schema; this is a safe no-op if so, and installs it
-- there if not.
create extension if not exists pgcrypto with schema extensions;

-- =======================================================================
-- create_group_with_setup
-- Atomic group creation: the group row, its owner membership (via the
-- existing groups_after_insert_create_owner_membership trigger), an
-- optional initial fixed contribution plan, optional initial invitations,
-- and an audit log entry are all created in one transaction — if any step
-- fails, nothing is created.
-- =======================================================================
create or replace function public.create_group_with_setup(
  p_name text,
  p_slug text,
  p_description text,
  p_country_code text,
  p_currency_code text,
  p_contribution_frequency text,
  p_contribution_type text,
  p_fixed_amount_minor_units bigint,
  p_financial_year_start_month smallint,
  p_rules text,
  p_invites jsonb
)
returns table (group_id uuid, slug text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_invite jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  begin
    insert into public.groups (
      name, slug, description, country_code, currency_code,
      contribution_frequency, contribution_type,
      financial_year_start_month, rules, created_by
    ) values (
      p_name, p_slug, p_description, p_country_code, p_currency_code,
      p_contribution_frequency, p_contribution_type,
      p_financial_year_start_month, p_rules, v_uid
    )
    returning id into v_group_id;
  exception
    when unique_violation then
      raise exception 'That group URL is already taken. Please choose a different one.';
  end;

  -- The groups_after_insert_create_owner_membership trigger has already
  -- fired synchronously at this point, so v_uid is now this group's
  -- owner and passes is_group_manager() for the inserts below.

  if p_contribution_type = 'fixed' and p_fixed_amount_minor_units is not null then
    insert into public.contribution_plans (
      group_id, name, amount_minor_units, currency_code,
      frequency, is_flexible, start_date, created_by
    ) values (
      v_group_id, 'Standard contribution', p_fixed_amount_minor_units, p_currency_code,
      p_contribution_frequency, false, current_date, v_uid
    );
  end if;

  if p_invites is not null then
    for v_invite in select * from jsonb_array_elements(p_invites)
    loop
      perform public.create_invitation(
        v_group_id,
        v_invite ->> 'email',
        v_invite ->> 'role'
      );
    end loop;
  end if;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_group_id, v_uid, 'group_created', 'groups', v_group_id,
    jsonb_build_object('name', p_name, 'slug', p_slug)
  );

  return query select v_group_id, p_slug;
end;
$$;

grant execute on function public.create_group_with_setup(
  text, text, text, text, text, text, text, bigint, smallint, text, jsonb
) to authenticated;

-- =======================================================================
-- create_invitation
-- Generates a cryptographically random 256-bit token, stores only its
-- SHA-256 hash, and returns the raw token exactly once (to the caller,
-- who is responsible for the invitation link — see docs/security-boundaries.md).
-- SECURITY INVOKER: relies on the group_invitations insert RLS policy
-- (is_group_manager), so only owners/administrators can call this
-- successfully.
-- =======================================================================
create or replace function public.create_invitation(
  p_group_id uuid,
  p_email text,
  p_role text
)
returns table (invitation_id uuid, raw_token text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_raw_token text;
  v_token_hash text;
  v_invitation_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_group_manager(p_group_id) then
    raise exception 'Only group owners and administrators can create invitations';
  end if;

  -- 'owner' is deliberately excluded: ownership is only granted via group
  -- creation or an explicit owner-to-owner promotion (see the
  -- group_memberships_update_managers policy), never via invitation.
  if p_role not in ('administrator', 'treasurer', 'loan_officer', 'auditor', 'member') then
    raise exception 'That role cannot be used for an invitation';
  end if;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');

  insert into public.group_invitations (
    group_id, email, role, token_hash, invited_by, expires_at
  ) values (
    p_group_id, lower(p_email), p_role, v_token_hash, v_uid,
    timezone('utc', now()) + interval '7 days'
  )
  returning id into v_invitation_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_group_id, v_uid, 'invitation_created', 'group_invitations', v_invitation_id,
    jsonb_build_object('email', lower(p_email), 'role', p_role)
  );

  return query select v_invitation_id, v_raw_token;
end;
$$;

grant execute on function public.create_invitation(uuid, text, text) to authenticated;

-- =======================================================================
-- revoke_invitation
-- SECURITY INVOKER: the SELECT below is itself subject to the
-- group_invitations RLS policy, so a non-manager simply finds no row
-- (indistinguishable "not found" rather than an authorisation-specific
-- error, which avoids confirming a group's invitations exist to a
-- non-member).
-- =======================================================================
create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select group_id, status into v_group_id, v_status
  from public.group_invitations
  where id = p_invitation_id;

  if v_group_id is null then
    raise exception 'Invitation not found';
  end if;

  if not public.is_group_manager(v_group_id) then
    raise exception 'Only group owners and administrators can revoke invitations';
  end if;

  if v_status <> 'pending' then
    raise exception 'Only a pending invitation can be revoked';
  end if;

  update public.group_invitations
  set status = 'revoked'
  where id = p_invitation_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'invitation_revoked', 'group_invitations', p_invitation_id, '{}'::jsonb);
end;
$$;

grant execute on function public.revoke_invitation(uuid) to authenticated;

-- =======================================================================
-- get_invitation_preview
-- SECURITY DEFINER: lets a visitor who is not yet signed in (and not yet
-- a group member) preview an invitation by its raw token, before they
-- have an account. Deliberately returns only the minimum needed to show
-- the invitation ("You've been invited to join X as Y") — never the
-- group_id, invited_by, or the token itself. Knowledge of the correct
-- 256-bit raw token is the only thing that authorises this read.
-- =======================================================================
create or replace function public.get_invitation_preview(p_token text)
returns table (
  group_name text,
  role text,
  email text,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_token_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
begin
  return query
    select g.name, gi.role, gi.email, gi.status, gi.expires_at
    from public.group_invitations gi
    join public.groups g on g.id = gi.group_id
    where gi.token_hash = v_token_hash
    limit 1;
end;
$$;

grant execute on function public.get_invitation_preview(text) to anon, authenticated;

-- =======================================================================
-- accept_invitation
-- SECURITY DEFINER: this is the ONLY path by which a user can add
-- themselves to a group (see the group_memberships_insert_managers
-- policy in 0001_init.sql, which no longer allows self-insert directly).
-- Validates: invitation exists, is pending (not accepted/revoked), has
-- not expired, and that the caller's verified auth.users email matches
-- the invited email — then inserts the membership with the role FROM THE
-- INVITATION ONLY (never a client-supplied role), marks the invitation
-- accepted, and writes an audit entry. `for update` row-locks the
-- invitation so two concurrent accepts of the same token can't both
-- succeed (single-use enforcement).
-- =======================================================================
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
    select 1 from public.group_memberships
    where group_id = v_invitation.group_id and user_id = v_uid
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
