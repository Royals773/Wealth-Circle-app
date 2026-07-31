-- WealthCircle — Phase 6 withdrawals and governance
--
-- Builds on Phase 1 tables that have existed, unused, since the initial
-- schema (withdrawal_requests, approval_requests/approval_decisions,
-- governance_proposals, votes — confirmed empty via a preflight query
-- before this file was finalized, see docs/phase-6-smoke-test.md).
--
-- Three real Phase 1 gaps are fixed here, not just extended:
--   1. withdrawal_requests could only ever be inserted by a manager
--      role — never by the member the withdrawal is actually for. The
--      insert policy now mirrors loan_applications' member self-insert.
--   2. The "two-person approval" on withdrawal_requests was hardcoded
--      via approved_by_1/approved_by_2 columns, never wired to any RPC.
--      Approval now routes through the generic approval_requests/
--      approval_decisions pair (already designed for this in Phase 1's
--      own comment), making the required approval count configurable
--      per group policy instead of fixed at two. The four dead
--      approved_by_*/approved_at_* columns and the also-unused
--      requires_dual_approval column are dropped.
--   3. votes' SELECT policy let any group member read every other
--      member's individual vote, at any time, including while voting
--      was still open — tightened below to "own vote while open, full
--      results once closed", the same class of over-broad-policy fix
--      Phases 2 and 4 made to tables nothing had exercised yet.
--
-- IDEMPOTENT: every statement below is guarded (if not exists / if
-- exists / create or replace / drop-then-add) so this file is safe to
-- run more than once, converging to the same end state regardless of
-- which statements already succeeded in an earlier attempt.

-- =======================================================================
-- withdrawal_policies — one active row per group, same "technically
-- multi-row, one active convention" as contribution_plans/loan_products.
-- =======================================================================
create table if not exists public.withdrawal_policies (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  status text not null default 'inactive' check (status in ('active', 'inactive')),
  min_amount_minor_units bigint check (min_amount_minor_units is null or min_amount_minor_units > 0),
  max_amount_minor_units bigint check (max_amount_minor_units is null or max_amount_minor_units > 0),
  notice_period_days integer not null default 0 check (notice_period_days >= 0),
  allow_partial boolean not null default true,
  reviewer_roles text[] not null default array['owner', 'administrator', 'treasurer'],
  required_approvals smallint not null default 1 check (required_approvals >= 1),
  allow_overdue_members boolean not null default false,
  block_members_with_active_loans boolean not null default false,
  large_withdrawal_threshold_minor_units bigint
    check (large_withdrawal_threshold_minor_units is null or large_withdrawal_threshold_minor_units > 0),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint withdrawal_policy_amount_range check (
    min_amount_minor_units is null or max_amount_minor_units is null
    or min_amount_minor_units <= max_amount_minor_units
  ),
  constraint withdrawal_policy_reviewer_roles_valid check (
    array_length(reviewer_roles, 1) >= 1
    and reviewer_roles <@ array['owner', 'administrator', 'treasurer', 'loan_officer', 'auditor']::text[]
  )
);

create or replace trigger withdrawal_policies_set_updated_at
  before update on public.withdrawal_policies
  for each row execute function public.set_updated_at();

alter table public.withdrawal_policies enable row level security;

drop policy if exists "withdrawal_policies_select_members" on public.withdrawal_policies;
create policy "withdrawal_policies_select_members" on public.withdrawal_policies
  for select using (public.is_group_member(group_id));

drop policy if exists "withdrawal_policies_insert_managers" on public.withdrawal_policies;
create policy "withdrawal_policies_insert_managers" on public.withdrawal_policies
  for insert with check (public.is_group_manager(group_id));

drop policy if exists "withdrawal_policies_update_managers" on public.withdrawal_policies;
create policy "withdrawal_policies_update_managers" on public.withdrawal_policies
  for update using (public.is_group_manager(group_id)) with check (public.is_group_manager(group_id));

-- Whether the current user holds one of the group's configured
-- withdrawal-reviewer roles. SECURITY DEFINER + fixed search_path, same
-- pattern as has_group_role/is_group_manager, so it can be used inside
-- RLS policies on withdrawal_requests/approval_requests/approval_decisions
-- without recursive policy evaluation. Returns false if no active policy
-- exists yet (has_group_role(..., '{}') is false), which is correct —
-- nothing to review before a policy is configured.
create or replace function public.is_withdrawal_reviewer(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.has_group_role(
    p_group_id,
    coalesce(
      (select wp.reviewer_roles from public.withdrawal_policies wp
       where wp.group_id = p_group_id and wp.status = 'active'
       order by wp.created_at desc limit 1),
      array[]::text[]
    )
  );
$$;

-- =======================================================================
-- withdrawal_requests
-- =======================================================================
alter table public.withdrawal_requests drop constraint if exists withdrawal_dual_approval_distinct;
alter table public.withdrawal_requests drop column if exists approved_by_1;
alter table public.withdrawal_requests drop column if exists approved_at_1;
alter table public.withdrawal_requests drop column if exists approved_by_2;
alter table public.withdrawal_requests drop column if exists approved_at_2;
alter table public.withdrawal_requests drop column if exists requires_dual_approval;

alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_status_check;
alter table public.withdrawal_requests add constraint withdrawal_requests_status_check
  check (status in (
    'draft', 'submitted', 'under_review', 'approved', 'rejected', 'cancelled',
    'awaiting_payment', 'paid_externally', 'reversed'
  ));
alter table public.withdrawal_requests alter column status set default 'submitted';

alter table public.withdrawal_requests
  add column if not exists reviewed_by uuid references public.profiles (id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists decision_notes text,
  add column if not exists paid_amount_minor_units bigint
    check (paid_amount_minor_units is null or paid_amount_minor_units > 0),
  add column if not exists payment_date date,
  add column if not exists paid_bank_reference text,
  add column if not exists paid_by uuid references public.profiles (id),
  add column if not exists payment_note text,
  add column if not exists linked_proposal_id uuid references public.governance_proposals (id);

alter table public.withdrawal_requests drop constraint if exists withdrawal_reversed_requires_reason;
alter table public.withdrawal_requests add constraint withdrawal_reversed_requires_reason
  check (status <> 'reversed' or reversal_reason is not null);

-- A member can only ever have one open (fund-reserving) request per
-- group at a time — the same rule and the same fix for
-- duplicate-submission-on-retry as loan_applications in Phase 4.
create unique index if not exists withdrawal_requests_one_open_per_member
  on public.withdrawal_requests (requested_by, group_id)
  where status in ('submitted', 'under_review', 'approved', 'awaiting_payment');

create index if not exists withdrawal_requests_group_status_idx on public.withdrawal_requests (group_id, status);

drop policy if exists "withdrawal_requests_select_members" on public.withdrawal_requests;
drop policy if exists "withdrawal_requests_select_own_or_reviewers" on public.withdrawal_requests;
create policy "withdrawal_requests_select_own_or_reviewers" on public.withdrawal_requests
  for select using (
    requested_by = auth.uid()
    or public.is_group_manager(group_id)
    or public.has_group_role(group_id, array['auditor'])
    or public.is_withdrawal_reviewer(group_id)
  );

drop policy if exists "withdrawal_requests_insert_managers" on public.withdrawal_requests;
drop policy if exists "withdrawal_requests_insert_own" on public.withdrawal_requests;
create policy "withdrawal_requests_insert_own" on public.withdrawal_requests
  for insert with check (public.is_group_member(group_id) and requested_by = auth.uid());

drop policy if exists "withdrawal_requests_update_managers" on public.withdrawal_requests;

-- Split exactly like loan_applications' self-approval fix in Phase 4: a
-- reviewer can never be the same person as the requester, structurally.
drop policy if exists "withdrawal_requests_review_reviewers" on public.withdrawal_requests;
create policy "withdrawal_requests_review_reviewers" on public.withdrawal_requests
  for update
  using (requested_by <> auth.uid() and public.is_withdrawal_reviewer(group_id))
  with check (requested_by <> auth.uid() and public.is_withdrawal_reviewer(group_id));

drop policy if exists "withdrawal_requests_cancel_own" on public.withdrawal_requests;
create policy "withdrawal_requests_cancel_own" on public.withdrawal_requests
  for update
  using (requested_by = auth.uid() and status in ('submitted', 'under_review'))
  with check (requested_by = auth.uid() and status = 'cancelled');

-- Locks a paid_externally record's financial fields against direct
-- edits, same pattern as protect_verified_contribution_record() /
-- protect_verified_repayment_record() — the only way out is 'reversed'.
create or replace function public.protect_paid_withdrawal_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'paid_externally' and new.status <> 'reversed' then
    if new.amount_minor_units <> old.amount_minor_units
      or new.currency_code <> old.currency_code
      or new.requested_by <> old.requested_by
      or new.group_id <> old.group_id
      or coalesce(new.paid_amount_minor_units, -1) <> coalesce(old.paid_amount_minor_units, -1)
      or coalesce(new.paid_bank_reference, '') <> coalesce(old.paid_bank_reference, '')
    then
      raise exception 'Paid withdrawal records cannot be edited directly — use the reversal workflow instead.';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger withdrawal_requests_protect_paid
  before update on public.withdrawal_requests
  for each row execute function public.protect_paid_withdrawal_record();

-- =======================================================================
-- approval_requests / approval_decisions — broaden from "managers only"
-- to also accept a group's configured withdrawal reviewers, since
-- required_approvals is no longer fixed at two owner/administrator
-- sign-offs. The unique(approval_request_id, approver_id) constraint
-- from Phase 1 already structurally prevents one officer supplying two
-- of the required approvals — unchanged, just now actually exercised.
-- =======================================================================
drop policy if exists "approval_requests_update_managers" on public.approval_requests;
drop policy if exists "approval_requests_update_reviewers" on public.approval_requests;
create policy "approval_requests_update_reviewers" on public.approval_requests
  for update using (
    public.is_group_manager(group_id)
    or (subject_type = 'withdrawal_request' and public.is_withdrawal_reviewer(group_id))
  );

drop policy if exists "approval_decisions_insert_approvers" on public.approval_decisions;
create policy "approval_decisions_insert_approvers" on public.approval_decisions
  for insert with check (
    approver_id = auth.uid()
    and exists (
      select 1 from public.approval_requests ar
      where ar.id = approval_request_id
        and (
          public.is_group_manager(ar.group_id)
          or (ar.subject_type = 'withdrawal_request' and public.is_withdrawal_reviewer(ar.group_id))
        )
    )
  );

-- =======================================================================
-- governance_proposals
-- =======================================================================
alter table public.governance_proposals
  add column if not exists category text,
  add column if not exists quorum_percent numeric(5, 2)
    check (quorum_percent is null or (quorum_percent >= 0 and quorum_percent <= 100)),
  add column if not exists approval_threshold_percent numeric(5, 2) not null default 50
    check (approval_threshold_percent > 0 and approval_threshold_percent <= 100),
  add column if not exists cancelled_by uuid references public.profiles (id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_reason text;

alter table public.governance_proposals alter column voting_opens_at set not null;
alter table public.governance_proposals alter column voting_closes_at set not null;

alter table public.governance_proposals drop constraint if exists governance_proposals_voting_window;
alter table public.governance_proposals add constraint governance_proposals_voting_window
  check (voting_closes_at > voting_opens_at);

alter table public.governance_proposals drop constraint if exists governance_proposals_status_check;
alter table public.governance_proposals add constraint governance_proposals_status_check
  check (status in ('open', 'cancelled'));
alter table public.governance_proposals alter column status set default 'open';

alter table public.governance_proposals drop constraint if exists governance_proposal_cancelled_requires_reason;
alter table public.governance_proposals add constraint governance_proposal_cancelled_requires_reason
  check (status <> 'cancelled'
    or (cancelled_by is not null and cancelled_at is not null and cancelled_reason is not null));

create index if not exists governance_proposals_group_status_idx on public.governance_proposals (group_id, status);

drop policy if exists "governance_proposals_update_managers" on public.governance_proposals;
drop policy if exists "governance_proposals_cancel_managers" on public.governance_proposals;
create policy "governance_proposals_cancel_managers" on public.governance_proposals
  for update
  using (public.is_group_manager(group_id))
  with check (public.is_group_manager(group_id) and status = 'cancelled');

-- The proposer may withdraw their own proposal only before voting opens
-- — once voting begins, material terms (and the proposal's existence)
-- are locked to the proposer; only an owner/administrator can cancel
-- past that point.
drop policy if exists "governance_proposals_cancel_own_before_voting" on public.governance_proposals;
create policy "governance_proposals_cancel_own_before_voting" on public.governance_proposals
  for update
  using (proposed_by = auth.uid() and status = 'open' and timezone('utc', now()) < voting_opens_at)
  with check (proposed_by = auth.uid() and status = 'cancelled');

-- =======================================================================
-- votes — was previously readable in full by any group member at any
-- time. Now: a member always sees their own vote; owners/administrators/
-- auditors always see everything (audit purposes); everyone sees the
-- full result only once voting has closed. Multiple permissive SELECT
-- policies on the same table are OR'd together by Postgres.
-- =======================================================================
drop policy if exists "votes_select_members" on public.votes;
drop policy if exists "votes_select_own_or_auditors" on public.votes;

create policy "votes_select_own_or_auditors" on public.votes
  for select using (
    voter_id = auth.uid()
    or public.is_group_manager(group_id)
    or public.has_group_role(group_id, array['auditor'])
  );

drop policy if exists "votes_select_all_after_close" on public.votes;
create policy "votes_select_all_after_close" on public.votes
  for select using (
    public.is_group_member(group_id)
    and exists (
      select 1 from public.governance_proposals gp
      where gp.id = votes.proposal_id and timezone('utc', now()) >= gp.voting_closes_at
    )
  );

create index if not exists votes_proposal_id_idx on public.votes (proposal_id);

-- SQL-level mirror of the eligibility/result logic in src/lib/governance.ts
-- (SQL can't call TypeScript) — used only as the internal gate inside
-- decide_withdrawal_request() for a large-withdrawal's linked proposal.
-- Anything DISPLAYED to users is computed in TypeScript from RLS-scoped
-- rows once voting closes (when the rows become visible per the policy
-- above); this SECURITY DEFINER function exists purely so that one
-- server-side enforcement point isn't blocked by the same visibility
-- restriction that correctly applies to end users.
create or replace function public.compute_proposal_passed(p_proposal_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_proposal public.governance_proposals%rowtype;
  v_for bigint := 0;
  v_against bigint := 0;
  v_abstain bigint := 0;
  v_eligible bigint := 0;
  v_quorum_met boolean := true;
begin
  select * into v_proposal from public.governance_proposals where id = p_proposal_id;
  if v_proposal.id is null or v_proposal.status = 'cancelled' then
    return false;
  end if;
  if timezone('utc', now()) < v_proposal.voting_closes_at then
    return false;
  end if;

  select
    count(*) filter (where choice = 'for'),
    count(*) filter (where choice = 'against'),
    count(*) filter (where choice = 'abstain')
  into v_for, v_against, v_abstain
  from public.votes where proposal_id = p_proposal_id;

  select count(*) into v_eligible
  from public.group_memberships
  where group_id = v_proposal.group_id and status = 'active' and joined_at <= v_proposal.voting_opens_at;

  if v_proposal.quorum_percent is not null and v_eligible > 0 then
    v_quorum_met := ((v_for + v_against + v_abstain)::numeric / v_eligible) * 100 >= v_proposal.quorum_percent;
  end if;

  if not v_quorum_met or (v_for + v_against) = 0 then
    return false;
  end if;

  return (v_for::numeric / (v_for + v_against)) * 100 >= v_proposal.approval_threshold_percent;
end;
$$;

grant execute on function public.compute_proposal_passed(uuid) to authenticated;

-- =======================================================================
-- upsert_withdrawal_policy
-- =======================================================================
create or replace function public.upsert_withdrawal_policy(
  p_group_id uuid,
  p_policy_id uuid,
  p_enabled boolean,
  p_min_amount_minor_units bigint,
  p_max_amount_minor_units bigint,
  p_notice_period_days integer,
  p_allow_partial boolean,
  p_reviewer_roles text[],
  p_required_approvals smallint,
  p_allow_overdue_members boolean,
  p_block_members_with_active_loans boolean,
  p_large_withdrawal_threshold_minor_units bigint
)
returns table (policy_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_policy_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_group_role(p_group_id, array['owner', 'administrator']) then
    raise exception 'Only owners and administrators can configure the withdrawal policy';
  end if;

  if p_reviewer_roles is null or array_length(p_reviewer_roles, 1) is null then
    raise exception 'Choose at least one role permitted to review withdrawal requests';
  end if;

  if p_required_approvals is null or p_required_approvals < 1 then
    raise exception 'At least one approval must be required';
  end if;

  v_status := case when p_enabled then 'active' else 'inactive' end;

  if p_policy_id is null then
    insert into public.withdrawal_policies (
      group_id, status, min_amount_minor_units, max_amount_minor_units, notice_period_days,
      allow_partial, reviewer_roles, required_approvals, allow_overdue_members,
      block_members_with_active_loans, large_withdrawal_threshold_minor_units, created_by
    ) values (
      p_group_id, v_status, p_min_amount_minor_units, p_max_amount_minor_units, p_notice_period_days,
      p_allow_partial, p_reviewer_roles, p_required_approvals, p_allow_overdue_members,
      p_block_members_with_active_loans, p_large_withdrawal_threshold_minor_units, v_uid
    )
    returning id into v_policy_id;

    insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
    values (p_group_id, v_uid, 'withdrawal_policy_created', 'withdrawal_policies', v_policy_id, '{}'::jsonb);
  else
    update public.withdrawal_policies
    set
      status = v_status,
      min_amount_minor_units = p_min_amount_minor_units,
      max_amount_minor_units = p_max_amount_minor_units,
      notice_period_days = p_notice_period_days,
      allow_partial = p_allow_partial,
      reviewer_roles = p_reviewer_roles,
      required_approvals = p_required_approvals,
      allow_overdue_members = p_allow_overdue_members,
      block_members_with_active_loans = p_block_members_with_active_loans,
      large_withdrawal_threshold_minor_units = p_large_withdrawal_threshold_minor_units
    where id = p_policy_id and group_id = p_group_id
    returning id into v_policy_id;

    if v_policy_id is null then
      raise exception 'Withdrawal policy not found';
    end if;

    insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
    values (p_group_id, v_uid, 'withdrawal_policy_updated', 'withdrawal_policies', v_policy_id, '{}'::jsonb);
  end if;

  return query select v_policy_id;
end;
$$;

grant execute on function public.upsert_withdrawal_policy(
  uuid, uuid, boolean, bigint, bigint, integer, boolean, text[], smallint, boolean, boolean, bigint
) to authenticated;

-- =======================================================================
-- request_withdrawal
-- Recomputes the available balance entirely server-side from verified
-- ledger data — never trusts a client-supplied amount. The safest
-- default rule: available = max(0, verified contributions − outstanding
-- loan principal − amounts already reserved by the member's own open
-- requests), further capped by the policy's min/max and, if the group
-- requires it, blocked outright for members with an active loan or
-- overdue contributions.
-- =======================================================================
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
    and status in ('submitted', 'under_review', 'approved', 'awaiting_payment');

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

-- =======================================================================
-- cancel_withdrawal_request
-- =======================================================================
create or replace function public.cancel_withdrawal_request(p_request_id uuid)
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
  from public.withdrawal_requests
  where id = p_request_id and requested_by = v_uid;

  if v_group_id is null then
    raise exception 'Withdrawal request not found';
  end if;
  if v_status not in ('submitted', 'under_review') then
    raise exception 'Only a request awaiting review can be cancelled';
  end if;

  update public.withdrawal_requests set status = 'cancelled' where id = p_request_id;
  update public.approval_requests set status = 'cancelled'
    where subject_type = 'withdrawal_request' and subject_id = p_request_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'withdrawal_cancelled', 'withdrawal_requests', p_request_id, '{}'::jsonb);
end;
$$;

grant execute on function public.cancel_withdrawal_request(uuid) to authenticated;

-- =======================================================================
-- review_withdrawal_request
-- =======================================================================
create or replace function public.review_withdrawal_request(p_request_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_status text;
  v_requested_by uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select group_id, status, requested_by into v_group_id, v_status, v_requested_by
  from public.withdrawal_requests where id = p_request_id;

  if v_group_id is null then
    raise exception 'Withdrawal request not found';
  end if;
  if not public.is_withdrawal_reviewer(v_group_id) then
    raise exception 'You are not authorised to review withdrawal requests for this group';
  end if;
  if v_requested_by = v_uid then
    raise exception 'You cannot review your own withdrawal request';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a submitted request can be marked under review';
  end if;

  update public.withdrawal_requests set status = 'under_review' where id = p_request_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'withdrawal_under_review', 'withdrawal_requests', p_request_id, '{}'::jsonb);
end;
$$;

grant execute on function public.review_withdrawal_request(uuid) to authenticated;

-- =======================================================================
-- decide_withdrawal_request
-- Records one approval_decisions row per reviewer (unique per approver,
-- structurally preventing one officer supplying two of the required
-- approvals). A single rejection short-circuits to 'rejected' — no need
-- for unanimous rejection, matching how loan rejection already works.
-- Once the configured number of approvals is reached, eligibility and
-- the available balance are recalculated again from scratch — not
-- trusted from submission time — and, if a large-withdrawal proposal is
-- linked, it must have passed. → 'awaiting_payment'.
-- =======================================================================
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
    and status in ('submitted', 'under_review', 'approved', 'awaiting_payment')
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

-- =======================================================================
-- confirm_withdrawal_payment
-- The only RPC that permanently reduces a member's available balance —
-- approval alone never does. Requires the paid amount to match exactly
-- (no partial payment of a single approved request) and respects the
-- policy's notice period.
-- =======================================================================
create or replace function public.confirm_withdrawal_payment(
  p_request_id uuid,
  p_paid_amount_minor_units bigint,
  p_bank_reference text,
  p_paid_at date,
  p_note text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.withdrawal_requests%rowtype;
  v_policy public.withdrawal_policies%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_request from public.withdrawal_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'Withdrawal request not found';
  end if;
  if not public.is_withdrawal_reviewer(v_request.group_id) then
    raise exception 'You are not authorised to confirm payment for this group';
  end if;
  if v_request.requested_by = v_uid then
    raise exception 'You cannot confirm payment of your own withdrawal request';
  end if;
  if v_request.status <> 'awaiting_payment' then
    raise exception 'Only a request awaiting payment can be confirmed as paid';
  end if;
  if p_paid_amount_minor_units is distinct from v_request.amount_minor_units then
    raise exception 'The paid amount must match the approved amount of %', v_request.amount_minor_units;
  end if;
  if p_bank_reference is null or length(trim(p_bank_reference)) = 0 then
    raise exception 'A bank reference is required';
  end if;

  select * into v_policy
  from public.withdrawal_policies
  where group_id = v_request.group_id and status = 'active'
  order by created_at desc limit 1;

  if v_policy.id is not null and v_policy.notice_period_days > 0
     and current_date < (v_request.created_at::date + v_policy.notice_period_days) then
    raise exception 'This group requires % day(s) notice before payment; earliest payment date is %',
      v_policy.notice_period_days, (v_request.created_at::date + v_policy.notice_period_days);
  end if;

  update public.withdrawal_requests
  set
    status = 'paid_externally',
    paid_amount_minor_units = p_paid_amount_minor_units,
    paid_bank_reference = p_bank_reference,
    payment_date = p_paid_at,
    paid_at = timezone('utc', now()),
    paid_by = v_uid,
    payment_note = p_note
  where id = p_request_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_request.group_id, v_uid, 'withdrawal_paid_externally', 'withdrawal_requests', p_request_id,
    jsonb_build_object('paid_amount_minor_units', p_paid_amount_minor_units, 'bank_reference', p_bank_reference));
end;
$$;

grant execute on function public.confirm_withdrawal_payment(uuid, bigint, text, date, text) to authenticated;

-- =======================================================================
-- reverse_withdrawal_payment
-- =======================================================================
create or replace function public.reverse_withdrawal_payment(p_request_id uuid, p_reason text)
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
    raise exception 'A reason is required to reverse a payment';
  end if;

  select group_id, status into v_group_id, v_status
  from public.withdrawal_requests where id = p_request_id;

  if v_group_id is null then
    raise exception 'Withdrawal request not found';
  end if;
  if not public.is_withdrawal_reviewer(v_group_id) then
    raise exception 'You are not authorised to reverse withdrawal payments for this group';
  end if;
  if v_status <> 'paid_externally' then
    raise exception 'Only a paid withdrawal can be reversed';
  end if;

  update public.withdrawal_requests
  set status = 'reversed', reversal_reason = p_reason
  where id = p_request_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'withdrawal_payment_reversed', 'withdrawal_requests', p_request_id,
    jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function public.reverse_withdrawal_payment(uuid, text) to authenticated;

-- =======================================================================
-- create_governance_proposal
-- Material terms (dates, thresholds, title, description) are locked once
-- voting opens by design — there is deliberately no update RPC for them.
-- =======================================================================
create or replace function public.create_governance_proposal(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_voting_opens_at timestamptz,
  p_voting_closes_at timestamptz,
  p_quorum_percent numeric,
  p_approval_threshold_percent numeric
)
returns table (proposal_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_proposal_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'You are not a member of this group';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'A title is required';
  end if;
  if p_voting_opens_at is null or p_voting_closes_at is null or p_voting_closes_at <= p_voting_opens_at then
    raise exception 'The voting window must close after it opens';
  end if;
  if p_approval_threshold_percent is null
     or p_approval_threshold_percent <= 0 or p_approval_threshold_percent > 100 then
    raise exception 'The approval threshold must be between 0 and 100 percent';
  end if;
  if p_quorum_percent is not null and (p_quorum_percent < 0 or p_quorum_percent > 100) then
    raise exception 'The quorum requirement must be between 0 and 100 percent';
  end if;

  insert into public.governance_proposals (
    group_id, title, description, category, proposed_by, status,
    voting_opens_at, voting_closes_at, quorum_percent, approval_threshold_percent
  ) values (
    p_group_id, p_title, p_description, p_category, v_uid, 'open',
    p_voting_opens_at, p_voting_closes_at, p_quorum_percent, p_approval_threshold_percent
  )
  returning id into v_proposal_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'governance_proposal_created', 'governance_proposals', v_proposal_id, '{}'::jsonb);

  return query select v_proposal_id;
end;
$$;

grant execute on function public.create_governance_proposal(
  uuid, text, text, text, timestamptz, timestamptz, numeric, numeric
) to authenticated;

-- =======================================================================
-- cancel_governance_proposal
-- =======================================================================
create or replace function public.cancel_governance_proposal(p_proposal_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_proposal public.governance_proposals%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to cancel a proposal';
  end if;

  select * into v_proposal from public.governance_proposals where id = p_proposal_id;
  if v_proposal.id is null then
    raise exception 'Proposal not found';
  end if;
  if v_proposal.status = 'cancelled' then
    raise exception 'This proposal has already been cancelled';
  end if;

  if public.is_group_manager(v_proposal.group_id) then
    null;
  elsif v_proposal.proposed_by = v_uid and timezone('utc', now()) < v_proposal.voting_opens_at then
    null;
  else
    raise exception 'Only an owner, administrator, or the proposer before voting opens, can cancel this proposal';
  end if;

  update public.governance_proposals
  set status = 'cancelled', cancelled_by = v_uid, cancelled_at = timezone('utc', now()), cancelled_reason = p_reason
  where id = p_proposal_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_proposal.group_id, v_uid, 'governance_proposal_cancelled', 'governance_proposals', p_proposal_id,
    jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function public.cancel_governance_proposal(uuid, text) to authenticated;

-- =======================================================================
-- cast_vote
-- One vote per eligible member, enforced by the unique(proposal_id,
-- voter_id) constraint from Phase 1 (unchanged) — the same
-- "database constraint, not just application logic" pattern already
-- used for contribution/repayment ledger integrity. Eligibility is a
-- join-date comparison against the proposal's voting_opens_at, the same
-- point-in-time approach already used for contribution/loan eligibility,
-- rather than a separate physical snapshot table.
-- =======================================================================
create or replace function public.cast_vote(p_proposal_id uuid, p_choice text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_proposal public.governance_proposals%rowtype;
  v_membership_status text;
  v_joined_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_choice not in ('for', 'against', 'abstain') then
    raise exception 'Invalid vote choice';
  end if;

  select * into v_proposal from public.governance_proposals where id = p_proposal_id;
  if v_proposal.id is null then
    raise exception 'Proposal not found';
  end if;
  if v_proposal.status = 'cancelled' then
    raise exception 'This proposal has been cancelled';
  end if;
  if timezone('utc', now()) < v_proposal.voting_opens_at then
    raise exception 'Voting has not opened yet for this proposal';
  end if;
  if timezone('utc', now()) >= v_proposal.voting_closes_at then
    raise exception 'Voting has closed for this proposal';
  end if;

  select status, joined_at into v_membership_status, v_joined_at
  from public.group_memberships
  where group_id = v_proposal.group_id and user_id = v_uid;

  if v_membership_status is null or v_membership_status <> 'active' then
    raise exception 'Only active members can vote';
  end if;
  if v_joined_at > v_proposal.voting_opens_at then
    raise exception 'Only members who had joined before voting opened are eligible to vote on this proposal';
  end if;

  insert into public.votes (proposal_id, group_id, voter_id, choice)
  values (p_proposal_id, v_proposal.group_id, v_uid, p_choice);

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_proposal.group_id, v_uid, 'vote_cast', 'governance_proposals', p_proposal_id,
    jsonb_build_object('choice', p_choice));
exception
  when unique_violation then
    raise exception 'You have already voted on this proposal';
end;
$$;

grant execute on function public.cast_vote(uuid, text) to authenticated;
