-- Phase 7 follow-up fix.
--
-- change_member_role, suspend_member, and remove_member each looked up
-- the target row with `select ... for update` before deciding what to
-- do. Under Postgres RLS, SELECT ... FOR UPDATE must satisfy not only
-- the SELECT policy but also the USING clause of any applicable UPDATE
-- policy. The only UPDATE policy covering these rows
-- (group_memberships_manage_non_owners) deliberately excludes
-- role = 'owner' — so locking a target row that currently holds
-- 'owner' silently returned no row, and the code fell through to the
-- generic "Member not found in this group" instead of the intended
-- "...owner cannot be suspended/removed..." / "...ownership transfer
-- workflow..." message. The action was still correctly blocked either
-- way (RLS did its job) — this only fixes which error message the
-- caller sees.
--
-- Fix: drop `for update` from these three lookups. Row locking isn't
-- load-bearing here — the later `update ... where group_id = ... and
-- user_id = ...` statement still serializes concurrent writes to the
-- same row on its own; a lost-update race here means at most a
-- redundant audit log row, not a financial or security correctness
-- issue (unlike the withdrawal-decision RPCs, where FOR UPDATE remains
-- necessary and unchanged).
--
-- Pure function-body replacements only — no schema, RLS policy, or
-- data changes. Safe to run more than once.

create or replace function public.change_member_role(
  p_group_id uuid,
  p_member_id uuid,
  p_new_role text,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_current_role text;
  v_current_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;
  if p_new_role not in ('administrator', 'treasurer', 'loan_officer', 'auditor', 'member') then
    raise exception 'Use the ownership transfer workflow to change the group''s owner';
  end if;
  if not public.is_group_manager(p_group_id) then
    raise exception 'Only owners and administrators can change member roles';
  end if;
  if p_member_id = v_uid then
    raise exception 'You cannot change your own role';
  end if;

  select role, status into v_current_role, v_current_status
  from public.group_memberships
  where group_id = p_group_id and user_id = p_member_id;

  if v_current_role is null then
    raise exception 'Member not found in this group';
  end if;
  if v_current_role = 'owner' then
    raise exception 'Use the ownership transfer workflow to change the group''s owner';
  end if;
  if v_current_status <> 'active' then
    raise exception 'Only an active member''s role can be changed';
  end if;
  if v_current_role = p_new_role then
    raise exception 'That is already this member''s role';
  end if;

  update public.group_memberships
  set role = p_new_role
  where group_id = p_group_id and user_id = p_member_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'member_role_changed', 'group_memberships', p_member_id,
    jsonb_build_object('previous_role', v_current_role, 'new_role', p_new_role, 'reason', p_reason));
end;
$$;

grant execute on function public.change_member_role(uuid, uuid, text, text) to authenticated;

create or replace function public.suspend_member(p_group_id uuid, p_member_id uuid, p_reason text)
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
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;
  if not public.is_group_manager(p_group_id) then
    raise exception 'Only owners and administrators can suspend members';
  end if;
  if p_member_id = v_uid then
    raise exception 'You cannot suspend yourself';
  end if;

  select role, status into v_role, v_status
  from public.group_memberships
  where group_id = p_group_id and user_id = p_member_id;

  if v_role is null then
    raise exception 'Member not found in this group';
  end if;
  if v_role = 'owner' then
    raise exception 'The group owner cannot be suspended — transfer ownership first';
  end if;
  if v_status <> 'active' then
    raise exception 'Only an active member can be suspended';
  end if;

  update public.group_memberships set status = 'suspended'
  where group_id = p_group_id and user_id = p_member_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'member_suspended', 'group_memberships', p_member_id,
    jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function public.suspend_member(uuid, uuid, text) to authenticated;

create or replace function public.remove_member(p_group_id uuid, p_member_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_status text;
  v_blockers text[];
  v_open_proposals integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;
  if not public.is_group_manager(p_group_id) then
    raise exception 'Only owners and administrators can remove members';
  end if;
  if p_member_id = v_uid then
    raise exception 'You cannot remove yourself — use the leave group option instead';
  end if;

  select role, status into v_role, v_status
  from public.group_memberships
  where group_id = p_group_id and user_id = p_member_id;

  if v_role is null then
    raise exception 'Member not found in this group';
  end if;
  if v_role = 'owner' then
    raise exception 'The group owner cannot be removed — transfer ownership first';
  end if;
  if v_status = 'removed' then
    raise exception 'This member has already been removed';
  end if;

  v_blockers := public.member_removal_blockers(p_group_id, p_member_id);
  if array_length(v_blockers, 1) > 0 then
    raise exception 'Cannot remove this member — unresolved: %', array_to_string(v_blockers, ', ');
  end if;

  select count(*) into v_open_proposals
  from public.governance_proposals
  where group_id = p_group_id and proposed_by = p_member_id and status = 'open';

  update public.group_memberships set status = 'removed'
  where group_id = p_group_id and user_id = p_member_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'member_removed', 'group_memberships', p_member_id,
    jsonb_build_object(
      'reason', p_reason, 'previous_role', v_role, 'open_proposals_at_removal', v_open_proposals
    ));
end;
$$;

grant execute on function public.remove_member(uuid, uuid, text) to authenticated;
