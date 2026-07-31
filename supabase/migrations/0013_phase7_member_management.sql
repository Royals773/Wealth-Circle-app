-- WealthCircle — Phase 7 member and role management
--
-- Closes a gap documented since Phase 2: group_memberships/status has
-- always supported 'suspended'/'removed' and RLS has always had *some*
-- self-promotion protection, but no RPC or UI ever existed to actually
-- change a role, suspend/reactivate/remove a member, or transfer
-- ownership.
--
-- A real, unfixed Phase 1 RLS gap is fixed here, not just extended:
-- the original group_memberships_update_managers policy checked
-- "is the actor a manager, and is the target not themselves" for
-- USING, and only checked "if the NEW role is owner, the actor must
-- already be an owner" for WITH CHECK. It never checked the target
-- row's CURRENT role — so an administrator could demote, suspend, or
-- remove an existing owner. No RPC ever exercised this (none existed),
-- but the policy itself was live and wrong. Replaced below with a
-- split-policy pattern (same shape as the Phase 4 loan self-approval
-- fix): owner rows are structurally outside the reach of the general
-- manage-members policy in both directions, so this class of bug can't
-- recur. The only way to change an owner's status is the new
-- ownership-transfer workflow, which demotes the outgoing owner in the
-- same transaction as promoting the incoming one.
--
-- IDEMPOTENT: every statement is guarded (if not exists / if exists /
-- create or replace / drop-then-add), following the same discipline
-- Phase 6 settled on after its own migration needed a follow-up fix.

-- =======================================================================
-- ownership_transfers
-- =======================================================================
create table if not exists public.ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id),
  to_user_id uuid not null references public.profiles (id),
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default (timezone('utc', now()) + interval '7 days'),
  responded_at timestamptz,
  responded_by uuid references public.profiles (id),
  cancelled_reason text,
  constraint ownership_transfer_distinct_parties check (from_user_id <> to_user_id)
);

-- One pending transfer per group at a time — also the concrete fix for
-- duplicate-submission-on-retry, the same pattern as
-- loan_applications_one_open_per_member / withdrawal_requests_one_open_per_member.
create unique index if not exists ownership_transfers_one_pending_per_group
  on public.ownership_transfers (group_id)
  where status = 'pending';

create index if not exists ownership_transfers_group_status_idx
  on public.ownership_transfers (group_id, status);

alter table public.ownership_transfers enable row level security;

drop policy if exists "ownership_transfers_select_involved_or_managers" on public.ownership_transfers;
create policy "ownership_transfers_select_involved_or_managers" on public.ownership_transfers
  for select using (
    from_user_id = auth.uid() or to_user_id = auth.uid() or public.is_group_manager(group_id)
  );

drop policy if exists "ownership_transfers_insert_owner" on public.ownership_transfers;
create policy "ownership_transfers_insert_owner" on public.ownership_transfers
  for insert with check (
    from_user_id = auth.uid() and public.has_group_role(group_id, array['owner'])
  );

-- The recipient may decline their own pending transfer.
drop policy if exists "ownership_transfers_decline_own" on public.ownership_transfers;
create policy "ownership_transfers_decline_own" on public.ownership_transfers
  for update
  using (to_user_id = auth.uid() and status = 'pending')
  with check (to_user_id = auth.uid() and status = 'declined');

-- Any current owner (not necessarily the original initiator) may
-- cancel a pending transfer for their group.
drop policy if exists "ownership_transfers_cancel_owner" on public.ownership_transfers;
create policy "ownership_transfers_cancel_owner" on public.ownership_transfers
  for update
  using (status = 'pending' and public.has_group_role(group_id, array['owner']))
  with check (status = 'cancelled');

-- Acceptance is handled entirely inside accept_ownership_transfer()
-- (SECURITY DEFINER, same pattern as accept_invitation) — no RLS
-- carve-out needed here for it.

-- =======================================================================
-- active_owner_count — SECURITY DEFINER, same shape as has_group_role,
-- used both inside RLS WITH CHECK clauses and inside RPCs so "never
-- leave a group without an active owner" is enforced structurally, not
-- just counted in the browser.
-- =======================================================================
create or replace function public.active_owner_count(p_group_id uuid)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::integer from public.group_memberships
  where group_id = p_group_id and role = 'owner' and status = 'active';
$$;

grant execute on function public.active_owner_count(uuid) to authenticated;

-- =======================================================================
-- member_removal_blockers — SECURITY DEFINER so it can read across
-- loans/loan_applications/repayments/withdrawal_requests/
-- ownership_transfers regardless of the caller's own RLS visibility
-- into each of those tables individually, but gated by its own
-- authorisation check (group manager, or the subject themselves) so it
-- can never be used to learn about a stranger's financial obligations.
-- Used by both remove_member() and leave_group() so the two share one
-- definition of "unsafe to remove."
-- =======================================================================
create or replace function public.member_removal_blockers(p_group_id uuid, p_user_id uuid)
returns text[]
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_blockers text[] := array[]::text[];
begin
  if not (public.is_group_manager(p_group_id) or auth.uid() = p_user_id) then
    raise exception 'Not authorised';
  end if;

  if exists (
    select 1 from public.loans
    where group_id = p_group_id and borrower_id = p_user_id and status = 'active'
  ) then
    v_blockers := array_append(v_blockers, 'an active loan');
  end if;

  if exists (
    select 1 from public.loan_applications
    where group_id = p_group_id and applicant_id = p_user_id and status in ('submitted', 'under_review')
  ) then
    v_blockers := array_append(v_blockers, 'a pending loan application');
  end if;

  if exists (
    select 1 from public.repayments
    where group_id = p_group_id and member_id = p_user_id and status = 'pending_verification'
  ) then
    v_blockers := array_append(v_blockers, 'an unverified repayment');
  end if;

  if exists (
    select 1 from public.withdrawal_requests
    where group_id = p_group_id and requested_by = p_user_id
      and status in ('submitted', 'under_review', 'approved', 'awaiting_payment')
  ) then
    v_blockers := array_append(v_blockers, 'a pending or approved withdrawal request');
  end if;

  if exists (
    select 1 from public.ownership_transfers
    where group_id = p_group_id and status = 'pending'
      and (from_user_id = p_user_id or to_user_id = p_user_id)
  ) then
    v_blockers := array_append(v_blockers, 'a pending ownership transfer');
  end if;

  return v_blockers;
end;
$$;

grant execute on function public.member_removal_blockers(uuid, uuid) to authenticated;

-- =======================================================================
-- group_memberships RLS — replace the one Phase 1 update policy with
-- two narrower ones. See the file header for the gap this closes.
-- =======================================================================
drop policy if exists "group_memberships_update_managers" on public.group_memberships;
drop policy if exists "group_memberships_manage_non_owners" on public.group_memberships;
drop policy if exists "group_memberships_leave_own" on public.group_memberships;

-- Managers change another member's role/status — but never a row that
-- currently holds 'owner', and never TO 'owner' either. Owner changes
-- exist entirely outside this policy's reach in both directions.
create policy "group_memberships_manage_non_owners" on public.group_memberships
  for update
  using (
    public.is_group_manager(group_id)
    and user_id <> auth.uid()
    and role <> 'owner'
  )
  with check (
    public.is_group_manager(group_id)
    and user_id <> auth.uid()
    and role <> 'owner'
  );

-- A member may remove themselves (leave), blocked if doing so would
-- leave the group without an active owner. Evaluated post-update, so
-- the departing row's own (now 'removed') status correctly excludes it
-- from the count.
create policy "group_memberships_leave_own" on public.group_memberships
  for update
  using (user_id = auth.uid() and status = 'active')
  with check (
    user_id = auth.uid()
    and status = 'removed'
    and (role <> 'owner' or public.active_owner_count(group_id) >= 1)
  );

create index if not exists group_memberships_group_status_idx
  on public.group_memberships (group_id, status);

-- =======================================================================
-- change_member_role
-- =======================================================================
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
  where group_id = p_group_id and user_id = p_member_id
  for update;

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

-- =======================================================================
-- suspend_member
-- =======================================================================
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
  where group_id = p_group_id and user_id = p_member_id
  for update;

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

-- =======================================================================
-- reactivate_member
-- =======================================================================
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

  select status into v_status
  from public.group_memberships
  where group_id = p_group_id and user_id = p_member_id
  for update;

  if v_status is null then
    raise exception 'Member not found in this group';
  end if;
  if v_status <> 'suspended' then
    raise exception 'Only a suspended member can be reactivated';
  end if;

  update public.group_memberships set status = 'active'
  where group_id = p_group_id and user_id = p_member_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'member_reactivated', 'group_memberships', p_member_id,
    jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function public.reactivate_member(uuid, uuid, text) to authenticated;

-- =======================================================================
-- remove_member
-- Open governance proposals the member created are recorded in the
-- audit metadata as an informational note, never a blocker — unlike an
-- unpaid loan or pending withdrawal, a proposal doesn't structurally
-- depend on its proposer remaining a member.
-- =======================================================================
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
  where group_id = p_group_id and user_id = p_member_id
  for update;

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

-- =======================================================================
-- leave_group
-- =======================================================================
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

  update public.group_memberships set status = 'removed'
  where group_id = p_group_id and user_id = v_uid;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'member_left', 'group_memberships', v_uid,
    jsonb_build_object('reason', p_reason, 'previous_role', v_role));
end;
$$;

grant execute on function public.leave_group(uuid, text) to authenticated;

-- =======================================================================
-- initiate_ownership_transfer
-- =======================================================================
create or replace function public.initiate_ownership_transfer(
  p_group_id uuid,
  p_to_user_id uuid,
  p_reason text
)
returns table (transfer_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_target_role text;
  v_target_status text;
  v_transfer_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;
  if not public.has_group_role(p_group_id, array['owner']) then
    raise exception 'Only the group owner can initiate an ownership transfer';
  end if;
  if p_to_user_id = v_uid then
    raise exception 'Choose a different member to transfer ownership to';
  end if;

  select role, status into v_target_role, v_target_status
  from public.group_memberships
  where group_id = p_group_id and user_id = p_to_user_id;

  if v_target_role is null then
    raise exception 'That member was not found in this group';
  end if;
  if v_target_status <> 'active' then
    raise exception 'Only an active member can receive ownership';
  end if;
  if v_target_role = 'owner' then
    raise exception 'That member is already an owner';
  end if;

  insert into public.ownership_transfers (group_id, from_user_id, to_user_id, reason)
  values (p_group_id, v_uid, p_to_user_id, p_reason)
  returning id into v_transfer_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'ownership_transfer_initiated', 'ownership_transfers', v_transfer_id,
    jsonb_build_object('to_user_id', p_to_user_id, 'reason', p_reason));

  return query select v_transfer_id;
exception
  when unique_violation then
    raise exception 'This group already has a pending ownership transfer';
end;
$$;

grant execute on function public.initiate_ownership_transfer(uuid, uuid, text) to authenticated;

-- =======================================================================
-- accept_ownership_transfer
-- SECURITY DEFINER — same reasoning as accept_invitation(): the
-- accepting user must be able to promote themselves to 'owner' and
-- demote the outgoing owner in one transaction, neither of which
-- ordinary RLS on group_memberships allows (by design, everywhere
-- else). Every check that would normally live in an RLS policy is
-- re-implemented explicitly here instead.
-- =======================================================================
create or replace function public.accept_ownership_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_transfer public.ownership_transfers%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_transfer from public.ownership_transfers where id = p_transfer_id for update;

  if v_transfer.id is null then
    raise exception 'Transfer not found';
  end if;
  if v_transfer.to_user_id <> v_uid then
    raise exception 'Only the intended recipient can accept this transfer';
  end if;
  if v_transfer.status <> 'pending' then
    raise exception 'This transfer is no longer pending';
  end if;
  if v_transfer.expires_at < timezone('utc', now()) then
    update public.ownership_transfers set status = 'expired' where id = p_transfer_id;
    raise exception 'This transfer has expired';
  end if;

  if not exists (
    select 1 from public.group_memberships
    where group_id = v_transfer.group_id and user_id = v_uid and status = 'active'
  ) then
    raise exception 'You must be an active member of this group to accept ownership';
  end if;
  if not exists (
    select 1 from public.group_memberships
    where group_id = v_transfer.group_id and user_id = v_transfer.from_user_id
      and role = 'owner' and status = 'active'
  ) then
    raise exception 'The outgoing owner is no longer active in this group';
  end if;

  update public.group_memberships set role = 'owner'
  where group_id = v_transfer.group_id and user_id = v_uid;

  update public.group_memberships set role = 'administrator'
  where group_id = v_transfer.group_id and user_id = v_transfer.from_user_id;

  update public.ownership_transfers
  set status = 'accepted', responded_at = timezone('utc', now()), responded_by = v_uid
  where id = p_transfer_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_transfer.group_id, v_uid, 'ownership_transfer_accepted', 'ownership_transfers', p_transfer_id,
    jsonb_build_object('from_user_id', v_transfer.from_user_id));
end;
$$;

grant execute on function public.accept_ownership_transfer(uuid) to authenticated;

-- =======================================================================
-- decline_ownership_transfer
-- =======================================================================
create or replace function public.decline_ownership_transfer(
  p_transfer_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_status text;
  v_to_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select group_id, status, to_user_id into v_group_id, v_status, v_to_user_id
  from public.ownership_transfers where id = p_transfer_id;

  if v_group_id is null then
    raise exception 'Transfer not found';
  end if;
  if v_to_user_id <> v_uid then
    raise exception 'Only the intended recipient can decline this transfer';
  end if;
  if v_status <> 'pending' then
    raise exception 'This transfer is no longer pending';
  end if;

  update public.ownership_transfers
  set status = 'declined', responded_at = timezone('utc', now()), responded_by = v_uid, cancelled_reason = p_reason
  where id = p_transfer_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'ownership_transfer_declined', 'ownership_transfers', p_transfer_id,
    jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function public.decline_ownership_transfer(uuid, text) to authenticated;

-- =======================================================================
-- cancel_ownership_transfer
-- =======================================================================
create or replace function public.cancel_ownership_transfer(p_transfer_id uuid, p_reason text)
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
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  select group_id, status into v_group_id, v_status
  from public.ownership_transfers where id = p_transfer_id;

  if v_group_id is null then
    raise exception 'Transfer not found';
  end if;
  if not public.has_group_role(v_group_id, array['owner']) then
    raise exception 'Only a group owner can cancel an ownership transfer';
  end if;
  if v_status <> 'pending' then
    raise exception 'This transfer is no longer pending';
  end if;

  update public.ownership_transfers
  set status = 'cancelled', responded_at = timezone('utc', now()), responded_by = v_uid, cancelled_reason = p_reason
  where id = p_transfer_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'ownership_transfer_cancelled', 'ownership_transfers', p_transfer_id,
    jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function public.cancel_ownership_transfer(uuid, text) to authenticated;
