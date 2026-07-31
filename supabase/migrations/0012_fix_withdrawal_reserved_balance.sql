-- WealthCircle — fix: paid withdrawals never reduced available balance
--
-- Real bug found during the Phase 6 manual walkthrough: request_withdrawal()
-- and decide_withdrawal_request() both computed "amount already reserved"
-- as the sum of only OPEN requests (submitted/under_review/approved/
-- awaiting_payment) — a request that had already been paid_externally
-- dropped out of that sum entirely, since it's neither open nor counted
-- anywhere else. A member's available balance never decreased once a
-- withdrawal was actually paid, letting them request (and, if a
-- second reviewer wasn't paying close attention, receive) the same
-- money again. Fixed by including paid_externally in the sum in both
-- functions — the only status that should ever release the hold again
-- is a genuine reversal (which flips status to 'reversed', already
-- correctly excluded).
--
-- Idempotent: two `create or replace function` statements, unchanged in
-- every other respect from 0011. Safe to run more than once.

create or replace function public.request_withdrawal(
  p_group_id uuid,
  p_amount_minor_units bigint,
  p_reason text,
  p_linked_proposal_id uuid
)
returns table (request_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_membership_status text;
  v_policy public.withdrawal_policies%rowtype;
  v_currency_code text;
  v_verified_contributions bigint := 0;
  v_outstanding_principal bigint := 0;
  v_reserved bigint := 0;
  v_available bigint;
  v_has_active_loan boolean := false;
  v_has_overdue_contributions boolean := false;
  v_period_days constant integer := 30;
  v_request_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount_minor_units is null or p_amount_minor_units <= 0 then
    raise exception 'Enter an amount greater than zero';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  select status into v_membership_status
  from public.group_memberships
  where group_id = p_group_id and user_id = v_uid;

  if v_membership_status is null then
    raise exception 'You are not a member of this group';
  end if;
  if v_membership_status <> 'active' then
    raise exception 'Only active members can request a withdrawal';
  end if;

  select * into v_policy
  from public.withdrawal_policies
  where group_id = p_group_id and status = 'active'
  order by created_at desc
  limit 1;

  if v_policy.id is null then
    raise exception 'Withdrawals are not currently enabled for this group';
  end if;

  select currency_code into v_currency_code from public.groups where id = p_group_id;

  select coalesce(sum(amount_minor_units), 0) into v_verified_contributions
  from public.contribution_records
  where group_id = p_group_id and member_id = v_uid and status in ('verified', 'reconciled');

  select coalesce(sum(
    l.principal_minor_units - coalesce((
      select sum(r.principal_portion_minor_units)
      from public.repayments r
      where r.loan_id = l.id and r.status in ('verified', 'reconciled')
    ), 0)
  ), 0) into v_outstanding_principal
  from public.loans l
  where l.group_id = p_group_id and l.borrower_id = v_uid and l.status = 'active';

  select exists (
    select 1 from public.loans l
    where l.group_id = p_group_id and l.borrower_id = v_uid and l.status = 'active'
  ) into v_has_active_loan;

  if v_policy.block_members_with_active_loans and v_has_active_loan then
    raise exception 'Members with an active loan cannot request a withdrawal under this group''s policy';
  end if;

  select coalesce(sum(amount_minor_units), 0) into v_reserved
  from public.withdrawal_requests
  where group_id = p_group_id and requested_by = v_uid
    and status in ('submitted', 'under_review', 'approved', 'awaiting_payment', 'paid_externally');

  v_available := greatest(0, v_verified_contributions - v_outstanding_principal - v_reserved);

  if not v_policy.allow_overdue_members then
    select exists (
      select 1 from public.contribution_plans cp
      where cp.group_id = p_group_id and cp.status = 'active'
        and (cp.is_flexible = false or cp.minimum_amount_minor_units is not null)
        and not exists (
          select 1 from public.contribution_records cr
          where cr.group_id = p_group_id and cr.member_id = v_uid
            and cr.status in ('verified', 'reconciled')
            and cr.received_at > (current_date - v_period_days)
        )
    ) into v_has_overdue_contributions;

    if v_has_overdue_contributions then
      raise exception 'Overdue contributions must be resolved before requesting a withdrawal';
    end if;
  end if;

  if p_amount_minor_units > v_available then
    raise exception 'The requested amount exceeds your available balance of %', v_available;
  end if;
  if v_policy.min_amount_minor_units is not null and p_amount_minor_units < v_policy.min_amount_minor_units then
    raise exception 'The minimum withdrawal amount for this group is %', v_policy.min_amount_minor_units;
  end if;
  if v_policy.max_amount_minor_units is not null and p_amount_minor_units > v_policy.max_amount_minor_units then
    raise exception 'The maximum withdrawal amount for this group is %', v_policy.max_amount_minor_units;
  end if;
  if not v_policy.allow_partial and p_amount_minor_units < v_available then
    raise exception 'This group only permits withdrawing your full available balance of %', v_available;
  end if;

  if v_policy.large_withdrawal_threshold_minor_units is not null
     and p_amount_minor_units >= v_policy.large_withdrawal_threshold_minor_units then
    if p_linked_proposal_id is null then
      raise exception
        'This amount requires a linked governance proposal to pass before it can be approved (large-withdrawal threshold: %)',
        v_policy.large_withdrawal_threshold_minor_units;
    end if;
    if not exists (
      select 1 from public.governance_proposals where id = p_linked_proposal_id and group_id = p_group_id
    ) then
      raise exception 'Linked proposal not found in this group';
    end if;
  end if;

  insert into public.withdrawal_requests (
    group_id, requested_by, amount_minor_units, currency_code, reason, status, linked_proposal_id
  ) values (
    p_group_id, v_uid, p_amount_minor_units, v_currency_code, p_reason, 'submitted', p_linked_proposal_id
  )
  returning id into v_request_id;

  insert into public.approval_requests (group_id, subject_type, subject_id, requested_by, required_approvals)
  values (p_group_id, 'withdrawal_request', v_request_id, v_uid, v_policy.required_approvals);

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'withdrawal_requested', 'withdrawal_requests', v_request_id,
    jsonb_build_object('amount_minor_units', p_amount_minor_units));

  return query select v_request_id;
exception
  when unique_violation then
    raise exception 'You already have an open withdrawal request for this group';
end;
$$;

grant execute on function public.request_withdrawal(uuid, bigint, text, uuid) to authenticated;

create or replace function public.decide_withdrawal_request(
  p_request_id uuid,
  p_decision text,
  p_notes text
)
returns table (request_id uuid, new_status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.withdrawal_requests%rowtype;
  v_approval_request_id uuid;
  v_required_approvals smallint;
  v_approvals_count integer;
  v_verified_contributions bigint := 0;
  v_outstanding_principal bigint := 0;
  v_reserved bigint := 0;
  v_available bigint;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into v_request from public.withdrawal_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'Withdrawal request not found';
  end if;
  if not public.is_withdrawal_reviewer(v_request.group_id) then
    raise exception 'You are not authorised to decide on withdrawal requests for this group';
  end if;
  if v_request.requested_by = v_uid then
    raise exception 'You cannot decide on your own withdrawal request';
  end if;
  if v_request.status not in ('submitted', 'under_review') then
    raise exception 'This request has already been decided';
  end if;

  select id, required_approvals into v_approval_request_id, v_required_approvals
  from public.approval_requests
  where subject_type = 'withdrawal_request' and subject_id = p_request_id
  for update;

  if v_approval_request_id is null then
    raise exception 'Approval record not found for this request';
  end if;

  insert into public.approval_decisions (approval_request_id, approver_id, decision, notes)
  values (v_approval_request_id, v_uid, p_decision, p_notes);

  if p_decision = 'rejected' then
    update public.withdrawal_requests
      set status = 'rejected', reviewed_by = v_uid, reviewed_at = timezone('utc', now()), decision_notes = p_notes
      where id = p_request_id;
    update public.approval_requests set status = 'rejected' where id = v_approval_request_id;

    insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_request.group_id, v_uid, 'withdrawal_rejected', 'withdrawal_requests', p_request_id,
      jsonb_build_object('reason', p_notes));

    return query select p_request_id, 'rejected'::text;
    return;
  end if;

  select count(*) into v_approvals_count
  from public.approval_decisions
  where approval_request_id = v_approval_request_id and decision = 'approved';

  update public.withdrawal_requests
    set status = 'under_review', reviewed_by = v_uid, reviewed_at = timezone('utc', now()), decision_notes = p_notes
    where id = p_request_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_request.group_id, v_uid, 'withdrawal_approval_recorded', 'withdrawal_requests', p_request_id,
    jsonb_build_object('approvals_so_far', v_approvals_count, 'required', v_required_approvals));

  if v_approvals_count < v_required_approvals then
    return query select p_request_id, 'under_review'::text;
    return;
  end if;

  select coalesce(sum(amount_minor_units), 0) into v_verified_contributions
  from public.contribution_records
  where group_id = v_request.group_id and member_id = v_request.requested_by
    and status in ('verified', 'reconciled');

  select coalesce(sum(
    l.principal_minor_units - coalesce((
      select sum(r.principal_portion_minor_units)
      from public.repayments r
      where r.loan_id = l.id and r.status in ('verified', 'reconciled')
    ), 0)
  ), 0) into v_outstanding_principal
  from public.loans l
  where l.group_id = v_request.group_id and l.borrower_id = v_request.requested_by and l.status = 'active';

  select coalesce(sum(amount_minor_units), 0) into v_reserved
  from public.withdrawal_requests
  where group_id = v_request.group_id and requested_by = v_request.requested_by
    and status in ('submitted', 'under_review', 'approved', 'awaiting_payment', 'paid_externally')
    and id <> p_request_id;

  v_available := greatest(0, v_verified_contributions - v_outstanding_principal - v_reserved);

  if v_request.amount_minor_units > v_available then
    raise exception 'This request can no longer be approved: it now exceeds the member''s available balance of %',
      v_available;
  end if;

  if v_request.linked_proposal_id is not null
     and not public.compute_proposal_passed(v_request.linked_proposal_id) then
    raise exception 'This withdrawal requires its linked governance proposal to pass before it can be approved';
  end if;

  update public.withdrawal_requests set status = 'awaiting_payment' where id = p_request_id;
  update public.approval_requests set status = 'approved' where id = v_approval_request_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_request.group_id, v_uid, 'withdrawal_approved', 'withdrawal_requests', p_request_id, '{}'::jsonb);

  return query select p_request_id, 'awaiting_payment'::text;
end;
$$;

grant execute on function public.decide_withdrawal_request(uuid, text, text) to authenticated;
