-- Fixes a real, pre-existing bug in leave_group() (0013_phase7_member_management.sql),
-- found live while running the Phase 10 security suite — unrelated to
-- Phase 10's own logic (leave_group is deliberately exempt from the
-- active-group gate and untouched by 0024).
--
-- Bug: leave_group() updated the caller's own group_memberships.status
-- to 'removed', then inserted an audit_logs row. audit_logs_insert_members
-- (0001_init.sql) requires is_group_member(group_id), which checks
-- group_memberships.status = 'active' for the calling user. Within the
-- same transaction, that check sees the just-applied 'removed' status
-- (not the pre-update 'active' one), so the insert always failed its
-- RLS check with "new row violates row-level security policy for table
-- audit_logs" — and since there's no exception handler, that failure
-- rolled back the whole call, including the membership update. This
-- means leave_group() has never successfully completed for any group,
-- active or otherwise; nothing caught it before because no prior live
-- test exercised a full successful call.
--
-- Fix: write the audit_logs row before updating the membership status,
-- while the caller still satisfies is_group_member(). Pure reordering
-- of two existing statements — no schema, RLS, or grant changes, and
-- no other function has this pattern (every other audit-logging RPC's
-- actor is a manager acting on a different row, not their own).
create or replace function public.leave_group(p_group_id uuid, p_reason text default null)
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
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role, status into v_role, v_status
  from public.group_memberships
  where group_id = p_group_id and user_id = v_uid
  for update;

  if v_role is null then
    raise exception 'You are not a member of this group';
  end if;
  if v_status <> 'active' then
    raise exception 'Only an active membership can be left';
  end if;
  if v_role = 'owner' and public.active_owner_count(p_group_id) <= 1 then
    raise exception 'You are the only owner of this group — transfer ownership before leaving';
  end if;

  v_blockers := public.member_removal_blockers(p_group_id, v_uid);
  if array_length(v_blockers, 1) > 0 then
    raise exception 'You cannot leave this group yet — unresolved: %', array_to_string(v_blockers, ', ');
  end if;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'member_left', 'group_memberships', v_uid,
    jsonb_build_object('reason', p_reason, 'previous_role', v_role));

  update public.group_memberships set status = 'removed'
  where group_id = p_group_id and user_id = v_uid;
end;
$$;
