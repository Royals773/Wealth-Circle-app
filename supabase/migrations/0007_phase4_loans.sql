-- WealthCircle — Phase 4 loan applications and repayments
--
-- Extends Phase 1's loan_products/loan_applications/loans/repayments
-- tables (all confirmed empty via a preflight query before this file was
-- finalized — see docs/phase-4-smoke-test.md) rather than creating
-- parallel tables, following the same SECURITY INVOKER + explicit role
-- check + audit-log-per-mutation pattern as 0002/0006.
--
-- Two real Phase 1 RLS gaps are fixed here, not just extended:
--   1. loan_applications/loans SELECT policies let ANY group member read
--      every other member's loan applications/loans — tightened to
--      "own record OR officer role", same class of fix Phase 3 made to
--      contribution_records.
--   2. loan_applications' single UPDATE policy
--      (`officer_role OR applicant_id = auth.uid()`) let an
--      officer-who-is-also-the-applicant approve their own request,
--      since the officer clause alone was sufficient. Split into two
--      policies below so an applicant can only ever move their own
--      application to 'cancelled', never approve/reject it.

-- =======================================================================
-- loan_products (→ the group's loan policy: one active row per group,
-- same "technically multi-row, one active convention" as
-- contribution_plans)
-- =======================================================================
alter table public.loan_products
  add column min_term_months integer check (min_term_months is null or min_term_months > 0),
  add column repayment_frequency text not null default 'monthly'
    check (repayment_frequency in ('weekly', 'biweekly', 'monthly', 'quarterly', 'annually')),
  add column max_loan_bps_of_contributions integer not null default 9500
    check (max_loan_bps_of_contributions > 0),
  add column interest_type text not null default 'one_time_flat'
    check (interest_type in ('one_time_flat')),
  add column allow_overdue_members boolean not null default false,
  add column grace_period_days integer not null default 0 check (grace_period_days >= 0);

alter table public.loan_products alter column interest_rate_bps set default 500;

alter table public.loan_products add constraint loan_products_term_range
  check (min_term_months is null or max_term_months is null or min_term_months <= max_term_months);

drop policy if exists "loan_products_update_loan_officers" on public.loan_products;
create policy "loan_products_update_loan_officers" on public.loan_products
  for update
  using (public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer']))
  with check (public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer']));

-- =======================================================================
-- loan_applications
-- =======================================================================
alter table public.loan_applications
  add column approved_amount_minor_units bigint
    check (approved_amount_minor_units is null or approved_amount_minor_units > 0),
  add column approved_term_months integer
    check (approved_term_months is null or approved_term_months > 0),
  add column approved_interest_rate_bps integer
    check (approved_interest_rate_bps is null or approved_interest_rate_bps >= 0),
  add column approved_repayment_frequency text
    check (approved_repayment_frequency is null
      or approved_repayment_frequency in ('weekly', 'biweekly', 'monthly', 'quarterly', 'annually'));

alter table public.loan_applications drop constraint loan_applications_status_check;
alter table public.loan_applications add constraint loan_applications_status_check
  check (status in ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'cancelled'));
alter table public.loan_applications alter column status set default 'submitted';

-- A member can only ever have one open (submitted/under_review)
-- application per group at a time — a sensible rule on its own, and the
-- concrete fix for duplicate submissions from repeated clicks or network
-- retries: a retried insert hits this and apply_for_loan() below turns
-- it into a friendly "you already have one pending" error.
create unique index loan_applications_one_open_per_member
  on public.loan_applications (applicant_id, group_id)
  where status in ('submitted', 'under_review');

drop policy if exists "loan_applications_select_members" on public.loan_applications;
create policy "loan_applications_select_own_or_officers" on public.loan_applications
  for select using (
    applicant_id = auth.uid()
    or public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer'])
  );

drop policy if exists "loan_applications_update_loan_officers" on public.loan_applications;

create policy "loan_applications_decide_officers" on public.loan_applications
  for update
  using (
    public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer'])
    and applicant_id <> auth.uid()
  )
  with check (
    public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer'])
    and applicant_id <> auth.uid()
  );

create policy "loan_applications_cancel_own" on public.loan_applications
  for update
  using (applicant_id = auth.uid() and status in ('submitted', 'under_review'))
  with check (applicant_id = auth.uid() and status = 'cancelled');

-- loan_applications_insert_members (is_group_member AND applicant_id =
-- auth.uid()) is already correct from 0001_init.sql — unchanged.

create index loan_applications_group_status_idx on public.loan_applications (group_id, status);

-- =======================================================================
-- loans — a row is created only once an application is APPROVED
-- (status 'awaiting_disbursement'), snapshotting the approved terms so
-- they never drift if the group's policy changes later. It becomes
-- 'active' only once record_disbursement() is called — approval alone
-- never activates a loan. Deliberately no stored overdue/fully_repaid/
-- partly_paid status: those are computed server-side from the schedule
-- and verified repayments (src/lib/loans.ts), the same approach Phase 3
-- proved out for contributions, avoiding a stored flag that could go
-- stale without a cron job this project doesn't have.
-- =======================================================================
alter table public.loans drop column due_date;

alter table public.loans
  add column interest_amount_minor_units bigint not null check (interest_amount_minor_units >= 0),
  add column total_repayable_minor_units bigint not null check (total_repayable_minor_units > 0),
  add column repayment_frequency text not null
    check (repayment_frequency in ('weekly', 'biweekly', 'monthly', 'quarterly', 'annually')),
  add column disbursed_by uuid references public.profiles (id),
  add column disbursement_date date,
  add column disbursement_reference text,
  add column disbursement_note text,
  add column defaulted_by uuid references public.profiles (id),
  add column defaulted_at timestamptz,
  add column default_reason text;

alter table public.loans drop constraint loans_status_check;
alter table public.loans add constraint loans_status_check
  check (status in ('awaiting_disbursement', 'active', 'defaulted', 'cancelled'));
alter table public.loans alter column status set default 'awaiting_disbursement';

alter table public.loans add constraint loans_active_requires_disbursement
  check (status <> 'active'
    or (disbursed_by is not null and disbursed_at is not null and disbursement_date is not null));

alter table public.loans add constraint loans_defaulted_requires_reason
  check (status <> 'defaulted'
    or (defaulted_by is not null and defaulted_at is not null and default_reason is not null));

drop policy if exists "loans_select_members" on public.loans;
create policy "loans_select_own_or_officers" on public.loans
  for select using (
    borrower_id = auth.uid()
    or public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer'])
  );

drop policy if exists "loans_update_loan_officers" on public.loans;
create policy "loans_update_loan_officers" on public.loans
  for update
  using (public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer']))
  with check (public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer']));

create index loans_group_status_idx on public.loans (group_id, status);
create index loans_borrower_id_idx on public.loans (borrower_id);

-- =======================================================================
-- repayments — same shape of additions Phase 3 made to
-- contribution_records, adapted for a loan-linked ledger.
-- =======================================================================
alter table public.repayments
  add column member_id uuid not null references public.profiles (id),
  add column payment_method text
    check (payment_method in ('cash', 'bank_transfer', 'mobile_money', 'cheque', 'other')),
  add column payment_reference text,
  add column notes text,
  add column received_at date not null default current_date,
  add column rejected_by uuid references public.profiles (id),
  add column rejected_at timestamptz,
  add column rejection_reason text,
  add column reversed_by uuid references public.profiles (id),
  add column reversed_at timestamptz,
  add column principal_portion_minor_units bigint not null check (principal_portion_minor_units >= 0),
  add column interest_portion_minor_units bigint not null check (interest_portion_minor_units >= 0);

alter table public.repayments drop constraint repayments_status_check;
alter table public.repayments add constraint repayments_status_check
  check (status in ('pending_verification', 'verified', 'reconciled', 'rejected', 'reversed'));
alter table public.repayments alter column status set default 'pending_verification';

alter table public.repayments add constraint repayment_verified_requires_verifier
  check (status not in ('verified', 'reconciled') or (verified_by is not null and verified_at is not null));

alter table public.repayments add constraint repayment_rejected_requires_reason
  check (status <> 'rejected'
    or (rejected_by is not null and rejected_at is not null and rejection_reason is not null));

alter table public.repayments add constraint repayment_reversed_requires_reason
  check (status <> 'reversed'
    or (reversed_by is not null and reversed_at is not null and reversal_reason is not null));

-- repayment_reconciled_requires_reconciler and
-- repayment_reversal_requires_reason already exist from 0001_init.sql
-- and still apply unchanged.

create or replace function public.protect_verified_repayment_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('verified', 'reconciled') and new.status <> 'reversed' then
    if new.amount_minor_units <> old.amount_minor_units
      or new.currency_code <> old.currency_code
      or new.member_id <> old.member_id
      or new.loan_id <> old.loan_id
      or new.group_id <> old.group_id
      or new.received_at <> old.received_at
      or coalesce(new.payment_method, '') <> coalesce(old.payment_method, '')
      or coalesce(new.payment_reference, '') <> coalesce(old.payment_reference, '')
      or new.principal_portion_minor_units <> old.principal_portion_minor_units
      or new.interest_portion_minor_units <> old.interest_portion_minor_units
    then
      raise exception 'Verified repayment records cannot be edited directly — use the reversal workflow instead.';
    end if;
  end if;
  return new;
end;
$$;

create trigger repayments_protect_verified
  before update on public.repayments
  for each row execute function public.protect_verified_repayment_record();

drop policy if exists "repayments_select_members" on public.repayments;
create policy "repayments_select_own_or_officers" on public.repayments
  for select using (
    member_id = auth.uid()
    or public.has_group_role(group_id, array['owner', 'administrator', 'treasurer', 'loan_officer', 'auditor'])
  );

drop policy if exists "repayments_insert_members" on public.repayments;
create policy "repayments_insert_officers" on public.repayments
  for insert with check (
    public.has_group_role(group_id, array['owner', 'administrator', 'treasurer', 'loan_officer'])
    and created_by = auth.uid()
  );

-- repayments_update_treasurers already exists from 0001_init.sql and
-- already includes loan_officer — unchanged.

create index repayments_member_id_idx on public.repayments (member_id);
create index repayments_group_status_idx on public.repayments (group_id, status);

-- =======================================================================
-- upsert_loan_product
-- =======================================================================
create or replace function public.upsert_loan_product(
  p_group_id uuid,
  p_product_id uuid,
  p_enabled boolean,
  p_max_loan_bps_of_contributions integer,
  p_max_amount_minor_units bigint,
  p_interest_type text,
  p_interest_rate_bps integer,
  p_min_term_months integer,
  p_max_term_months integer,
  p_repayment_frequency text,
  p_allow_overdue_members boolean,
  p_grace_period_days integer
)
returns table (product_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_product_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_group_role(p_group_id, array['owner', 'administrator', 'loan_officer']) then
    raise exception 'Only owners, administrators and loan officers can configure the loan policy';
  end if;

  v_status := case when p_enabled then 'active' else 'inactive' end;

  if p_product_id is null then
    insert into public.loan_products (
      group_id, name, interest_type, interest_rate_bps, max_amount_minor_units,
      min_term_months, max_term_months, repayment_frequency,
      max_loan_bps_of_contributions, allow_overdue_members, grace_period_days,
      status, created_by
    ) values (
      p_group_id, 'Standard loan', p_interest_type, p_interest_rate_bps, p_max_amount_minor_units,
      p_min_term_months, p_max_term_months, p_repayment_frequency,
      p_max_loan_bps_of_contributions, p_allow_overdue_members, p_grace_period_days,
      v_status, v_uid
    )
    returning id into v_product_id;

    insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
    values (p_group_id, v_uid, 'loan_product_created', 'loan_products', v_product_id, '{}'::jsonb);
  else
    update public.loan_products
    set
      interest_type = p_interest_type,
      interest_rate_bps = p_interest_rate_bps,
      max_amount_minor_units = p_max_amount_minor_units,
      min_term_months = p_min_term_months,
      max_term_months = p_max_term_months,
      repayment_frequency = p_repayment_frequency,
      max_loan_bps_of_contributions = p_max_loan_bps_of_contributions,
      allow_overdue_members = p_allow_overdue_members,
      grace_period_days = p_grace_period_days,
      status = v_status
    where id = p_product_id and group_id = p_group_id
    returning id into v_product_id;

    if v_product_id is null then
      raise exception 'Loan product not found';
    end if;

    insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
    values (p_group_id, v_uid, 'loan_product_updated', 'loan_products', v_product_id, '{}'::jsonb);
  end if;

  return query select v_product_id;
end;
$$;

grant execute on function public.upsert_loan_product(
  uuid, uuid, boolean, integer, bigint, text, integer, integer, integer, text, boolean, integer
) to authenticated;

-- =======================================================================
-- apply_for_loan
-- Recomputes eligibility entirely server-side from verified ledger data
-- — never trusts a client-supplied amount or eligibility flag. The
-- overdue-members gate below approximates "one repayment/contribution
-- period" in days (7/14/30/90/365) rather than reconstructing exact
-- calendar period boundaries in SQL — a documented simplification used
-- only for this eligibility gate, not for anything displayed to users
-- (which uses the precise period math in src/lib/contribution-periods.ts
-- and src/lib/loans.ts). See docs/security-boundaries.md.
-- =======================================================================
create or replace function public.apply_for_loan(
  p_group_id uuid,
  p_amount_minor_units bigint,
  p_term_months integer,
  p_purpose text
)
returns table (application_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_membership_status text;
  v_product public.loan_products%rowtype;
  v_currency_code text;
  v_verified_contributions bigint := 0;
  v_outstanding_principal bigint := 0;
  v_max_loan bigint;
  v_available bigint;
  v_period_days integer;
  v_has_overdue_contributions boolean := false;
  v_has_overdue_repayments boolean := false;
  v_application_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount_minor_units is null or p_amount_minor_units <= 0 then
    raise exception 'Enter an amount greater than zero';
  end if;

  select status into v_membership_status
  from public.group_memberships
  where group_id = p_group_id and user_id = v_uid;

  if v_membership_status is null then
    raise exception 'You are not a member of this group';
  end if;
  if v_membership_status <> 'active' then
    raise exception 'Only active members can apply for a loan';
  end if;

  select * into v_product
  from public.loan_products
  where group_id = p_group_id and status = 'active'
  order by created_at desc
  limit 1;

  if v_product.id is null then
    raise exception 'Loans are not currently enabled for this group';
  end if;

  if p_term_months < coalesce(v_product.min_term_months, 1)
     or p_term_months > coalesce(v_product.max_term_months, 999) then
    raise exception 'The requested term is outside this group''s allowed repayment period';
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

  v_max_loan := floor(v_verified_contributions * v_product.max_loan_bps_of_contributions / 10000.0);
  if v_product.max_amount_minor_units is not null then
    v_max_loan := least(v_max_loan, v_product.max_amount_minor_units);
  end if;
  v_available := greatest(0, v_max_loan - v_outstanding_principal);

  if p_amount_minor_units > v_available then
    raise exception 'The requested amount exceeds your available borrowing limit of %', v_available;
  end if;

  v_period_days := case v_product.repayment_frequency
    when 'weekly' then 7
    when 'biweekly' then 14
    when 'monthly' then 30
    when 'quarterly' then 90
    else 365
  end;

  if not v_product.allow_overdue_members then
    select exists (
      select 1 from public.loans l
      where l.group_id = p_group_id and l.borrower_id = v_uid and l.status = 'active'
        and l.disbursed_at < (timezone('utc', now()) - make_interval(days => v_period_days))
        and not exists (
          select 1 from public.repayments r
          where r.loan_id = l.id and r.status in ('verified', 'reconciled')
            and r.received_at > (current_date - (v_period_days + v_product.grace_period_days))
        )
    ) into v_has_overdue_repayments;

    select exists (
      select 1 from public.contribution_plans cp
      where cp.group_id = p_group_id and cp.status = 'active'
        and (cp.is_flexible = false or cp.minimum_amount_minor_units is not null)
        and not exists (
          select 1 from public.contribution_records cr
          where cr.group_id = p_group_id and cr.member_id = v_uid
            and cr.status in ('verified', 'reconciled')
            and cr.received_at > (current_date - (v_period_days + v_product.grace_period_days))
        )
    ) into v_has_overdue_contributions;

    if v_has_overdue_contributions then
      raise exception 'Overdue contributions must be resolved before applying for a loan';
    end if;
    if v_has_overdue_repayments then
      raise exception 'Overdue loan repayments must be resolved before applying for another loan';
    end if;
  end if;

  insert into public.loan_applications (
    group_id, loan_product_id, applicant_id, amount_requested_minor_units, currency_code,
    term_months, purpose, status
  ) values (
    p_group_id, v_product.id, v_uid, p_amount_minor_units, v_currency_code,
    p_term_months, p_purpose, 'submitted'
  )
  returning id into v_application_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_group_id, v_uid, 'loan_application_submitted', 'loan_applications', v_application_id,
    jsonb_build_object('amount_minor_units', p_amount_minor_units, 'term_months', p_term_months)
  );

  return query select v_application_id;
exception
  when unique_violation then
    raise exception 'You already have an application awaiting a decision for this group';
end;
$$;

grant execute on function public.apply_for_loan(uuid, bigint, integer, text) to authenticated;

-- =======================================================================
-- mark_loan_under_review
-- =======================================================================
create or replace function public.mark_loan_under_review(p_application_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_applicant_id uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select group_id, applicant_id, status into v_group_id, v_applicant_id, v_status
  from public.loan_applications where id = p_application_id;

  if v_group_id is null then
    raise exception 'Loan application not found';
  end if;

  if not public.has_group_role(v_group_id, array['owner', 'administrator', 'loan_officer']) then
    raise exception 'Only owners, administrators and loan officers can review applications';
  end if;

  if v_applicant_id = v_uid then
    raise exception 'You cannot review your own application';
  end if;

  if v_status <> 'submitted' then
    raise exception 'Only a submitted application can be marked under review';
  end if;

  update public.loan_applications set status = 'under_review' where id = p_application_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'loan_application_under_review', 'loan_applications', p_application_id, '{}'::jsonb);
end;
$$;

grant execute on function public.mark_loan_under_review(uuid) to authenticated;

-- =======================================================================
-- decide_loan_application
-- Approving snapshots the approved terms onto loan_applications AND
-- creates the loans row (status 'awaiting_disbursement') in the same
-- transaction — no intermediate state where an application is approved
-- but has no corresponding loan row. `applicant_id <> auth.uid()` is
-- checked here explicitly as defense-in-depth on top of the RLS fix
-- above.
-- =======================================================================
create or replace function public.decide_loan_application(
  p_application_id uuid,
  p_decision text,
  p_approved_amount_minor_units bigint,
  p_approved_term_months integer,
  p_approved_interest_rate_bps integer,
  p_approved_repayment_frequency text,
  p_notes text
)
returns table (application_id uuid, loan_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_application public.loan_applications%rowtype;
  v_interest_amount bigint;
  v_total_repayable bigint;
  v_loan_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into v_application from public.loan_applications where id = p_application_id for update;

  if v_application.id is null then
    raise exception 'Loan application not found';
  end if;

  if not public.has_group_role(v_application.group_id, array['owner', 'administrator', 'loan_officer']) then
    raise exception 'Only owners, administrators and loan officers can decide on applications';
  end if;

  if v_application.applicant_id = v_uid then
    raise exception 'You cannot decide on your own application';
  end if;

  if v_application.status not in ('submitted', 'under_review') then
    raise exception 'This application has already been decided';
  end if;

  if p_decision = 'rejected' then
    update public.loan_applications
    set status = 'rejected', reviewed_by = v_uid, reviewed_at = timezone('utc', now()), decision_notes = p_notes
    where id = p_application_id;

    insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_application.group_id, v_uid, 'loan_application_rejected', 'loan_applications', p_application_id,
      jsonb_build_object('reason', p_notes));

    return query select p_application_id, null::uuid;
    return;
  end if;

  if p_approved_amount_minor_units is null or p_approved_amount_minor_units <= 0 then
    raise exception 'An approved amount is required';
  end if;
  if p_approved_term_months is null or p_approved_term_months <= 0 then
    raise exception 'An approved term is required';
  end if;

  v_interest_amount := round((p_approved_amount_minor_units * p_approved_interest_rate_bps) / 10000.0);
  v_total_repayable := p_approved_amount_minor_units + v_interest_amount;

  update public.loan_applications
  set
    status = 'approved',
    reviewed_by = v_uid,
    reviewed_at = timezone('utc', now()),
    decision_notes = p_notes,
    approved_amount_minor_units = p_approved_amount_minor_units,
    approved_term_months = p_approved_term_months,
    approved_interest_rate_bps = p_approved_interest_rate_bps,
    approved_repayment_frequency = p_approved_repayment_frequency
  where id = p_application_id;

  insert into public.loans (
    group_id, loan_application_id, borrower_id, principal_minor_units, currency_code,
    interest_rate_bps, interest_amount_minor_units, total_repayable_minor_units,
    term_months, repayment_frequency, status
  ) values (
    v_application.group_id, p_application_id, v_application.applicant_id, p_approved_amount_minor_units,
    v_application.currency_code, p_approved_interest_rate_bps, v_interest_amount, v_total_repayable,
    p_approved_term_months, p_approved_repayment_frequency, 'awaiting_disbursement'
  )
  returning id into v_loan_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_application.group_id, v_uid, 'loan_application_approved', 'loan_applications', p_application_id,
    jsonb_build_object('loan_id', v_loan_id, 'approved_amount_minor_units', p_approved_amount_minor_units));

  return query select p_application_id, v_loan_id;
end;
$$;

grant execute on function public.decide_loan_application(
  uuid, text, bigint, integer, integer, text, text
) to authenticated;

-- =======================================================================
-- cancel_loan_application
-- =======================================================================
create or replace function public.cancel_loan_application(p_application_id uuid)
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
  from public.loan_applications
  where id = p_application_id and applicant_id = v_uid;

  if v_group_id is null then
    raise exception 'Loan application not found';
  end if;

  if v_status not in ('submitted', 'under_review') then
    raise exception 'Only a pending application can be cancelled';
  end if;

  update public.loan_applications set status = 'cancelled' where id = p_application_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'loan_application_cancelled', 'loan_applications', p_application_id, '{}'::jsonb);
end;
$$;

grant execute on function public.cancel_loan_application(uuid) to authenticated;

-- =======================================================================
-- record_disbursement
-- The only path from 'awaiting_disbursement' to 'active' — approval
-- alone never activates a loan.
-- =======================================================================
create or replace function public.record_disbursement(
  p_loan_id uuid,
  p_disbursement_date date,
  p_disbursement_reference text,
  p_disbursement_note text
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
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select group_id, status into v_group_id, v_status from public.loans where id = p_loan_id;

  if v_group_id is null then
    raise exception 'Loan not found';
  end if;

  if not public.has_group_role(v_group_id, array['owner', 'administrator', 'loan_officer']) then
    raise exception 'Only owners, administrators and loan officers can record a disbursement';
  end if;

  if v_status <> 'awaiting_disbursement' then
    raise exception 'Only a loan awaiting disbursement can be marked disbursed';
  end if;

  update public.loans
  set
    status = 'active',
    disbursed_by = v_uid,
    disbursed_at = timezone('utc', now()),
    disbursement_date = p_disbursement_date,
    disbursement_reference = p_disbursement_reference,
    disbursement_note = p_disbursement_note
  where id = p_loan_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'loan_disbursed', 'loans', p_loan_id,
    jsonb_build_object('disbursement_date', p_disbursement_date));
end;
$$;

grant execute on function public.record_disbursement(uuid, date, text, text) to authenticated;

-- =======================================================================
-- mark_loan_defaulted
-- =======================================================================
create or replace function public.mark_loan_defaulted(p_loan_id uuid, p_reason text)
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

  select group_id, status into v_group_id, v_status from public.loans where id = p_loan_id;

  if v_group_id is null then
    raise exception 'Loan not found';
  end if;

  if not public.has_group_role(v_group_id, array['owner', 'administrator', 'loan_officer']) then
    raise exception 'Only owners, administrators and loan officers can mark a loan as defaulted';
  end if;

  if v_status <> 'active' then
    raise exception 'Only an active loan can be marked as defaulted';
  end if;

  update public.loans
  set status = 'defaulted', defaulted_by = v_uid, defaulted_at = timezone('utc', now()), default_reason = p_reason
  where id = p_loan_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'loan_defaulted', 'loans', p_loan_id, jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function public.mark_loan_defaulted(uuid, text) to authenticated;

-- =======================================================================
-- record_repayment
-- Splits the payment between principal and interest proportionally to
-- the loan's overall principal:total-repayable ratio — see
-- src/lib/loans.ts's computeProportionalAllocation for the documented
-- policy this mirrors.
-- =======================================================================
create or replace function public.record_repayment(
  p_loan_id uuid,
  p_amount_minor_units bigint,
  p_received_at date,
  p_payment_method text,
  p_payment_reference text,
  p_notes text
)
returns table (repayment_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_loan public.loans%rowtype;
  v_repayment_id uuid;
  v_principal_portion bigint;
  v_interest_portion bigint;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_loan from public.loans where id = p_loan_id;

  if v_loan.id is null then
    raise exception 'Loan not found';
  end if;

  if not public.has_group_role(v_loan.group_id, array['owner', 'administrator', 'treasurer', 'loan_officer']) then
    raise exception 'Only owners, administrators, treasurers and loan officers can record repayments';
  end if;

  if v_loan.status <> 'active' then
    raise exception 'Repayments can only be recorded against an active loan';
  end if;

  if p_amount_minor_units is null or p_amount_minor_units <= 0 then
    raise exception 'Enter an amount greater than zero';
  end if;

  v_principal_portion :=
    floor((p_amount_minor_units * v_loan.principal_minor_units) / v_loan.total_repayable_minor_units::numeric);
  v_interest_portion := p_amount_minor_units - v_principal_portion;

  insert into public.repayments (
    group_id, loan_id, member_id, amount_minor_units, currency_code,
    principal_portion_minor_units, interest_portion_minor_units,
    received_at, payment_method, payment_reference, notes, status, created_by
  ) values (
    v_loan.group_id, p_loan_id, v_loan.borrower_id, p_amount_minor_units, v_loan.currency_code,
    v_principal_portion, v_interest_portion,
    p_received_at, p_payment_method, p_payment_reference, p_notes, 'pending_verification', v_uid
  )
  returning id into v_repayment_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_loan.group_id, v_uid, 'repayment_recorded', 'repayments', v_repayment_id,
    jsonb_build_object('loan_id', p_loan_id, 'amount_minor_units', p_amount_minor_units));

  return query select v_repayment_id;
end;
$$;

grant execute on function public.record_repayment(uuid, bigint, date, text, text, text) to authenticated;

-- =======================================================================
-- verify_repayment / reconcile_repayment / reject_repayment /
-- reverse_repayment — directly mirror the contribution equivalents in
-- 0006_phase3_contributions.sql.
-- =======================================================================
create or replace function public.verify_repayment(p_repayment_id uuid)
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

  select group_id, status into v_group_id, v_status from public.repayments where id = p_repayment_id;

  if v_group_id is null then
    raise exception 'Repayment record not found';
  end if;

  if not public.has_group_role(v_group_id, array['owner', 'administrator', 'treasurer', 'loan_officer']) then
    raise exception 'Only owners, administrators, treasurers and loan officers can verify repayments';
  end if;

  if v_status <> 'pending_verification' then
    raise exception 'Only a record pending verification can be verified';
  end if;

  update public.repayments
  set status = 'verified', verified_by = v_uid, verified_at = timezone('utc', now())
  where id = p_repayment_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'repayment_verified', 'repayments', p_repayment_id, '{}'::jsonb);
end;
$$;

grant execute on function public.verify_repayment(uuid) to authenticated;

create or replace function public.reconcile_repayment(p_repayment_id uuid)
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

  select group_id, status into v_group_id, v_status from public.repayments where id = p_repayment_id;

  if v_group_id is null then
    raise exception 'Repayment record not found';
  end if;

  if not public.has_group_role(v_group_id, array['owner', 'administrator', 'treasurer', 'loan_officer']) then
    raise exception 'Only owners, administrators, treasurers and loan officers can reconcile repayments';
  end if;

  if v_status <> 'verified' then
    raise exception 'Only a verified record can be reconciled';
  end if;

  update public.repayments
  set status = 'reconciled', reconciled_by = v_uid, reconciled_at = timezone('utc', now())
  where id = p_repayment_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'repayment_reconciled', 'repayments', p_repayment_id, '{}'::jsonb);
end;
$$;

grant execute on function public.reconcile_repayment(uuid) to authenticated;

create or replace function public.reject_repayment(p_repayment_id uuid, p_reason text)
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

  select group_id, status into v_group_id, v_status from public.repayments where id = p_repayment_id;

  if v_group_id is null then
    raise exception 'Repayment record not found';
  end if;

  if not public.has_group_role(v_group_id, array['owner', 'administrator', 'treasurer', 'loan_officer']) then
    raise exception 'Only owners, administrators, treasurers and loan officers can reject repayments';
  end if;

  if v_status <> 'pending_verification' then
    raise exception 'Only a record pending verification can be rejected';
  end if;

  update public.repayments
  set status = 'rejected', rejected_by = v_uid, rejected_at = timezone('utc', now()), rejection_reason = p_reason
  where id = p_repayment_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'repayment_rejected', 'repayments', p_repayment_id,
    jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function public.reject_repayment(uuid, text) to authenticated;

create or replace function public.reverse_repayment(
  p_repayment_id uuid,
  p_reason text,
  p_replacement jsonb default null
)
returns table (repayment_id uuid, replacement_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_original public.repayments%rowtype;
  v_replacement_id uuid;
  v_amount bigint;
  v_loan public.loans%rowtype;
  v_principal_portion bigint;
  v_interest_portion bigint;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  select * into v_original from public.repayments where id = p_repayment_id for update;

  if v_original.id is null then
    raise exception 'Repayment record not found';
  end if;

  if not public.has_group_role(v_original.group_id, array['owner', 'administrator', 'treasurer', 'loan_officer']) then
    raise exception 'Only owners, administrators, treasurers and loan officers can reverse repayments';
  end if;

  if v_original.status not in ('verified', 'reconciled') then
    raise exception 'Only a verified or reconciled record can be reversed';
  end if;

  update public.repayments
  set status = 'reversed', reversed_by = v_uid, reversed_at = timezone('utc', now()), reversal_reason = p_reason
  where id = p_repayment_id;

  if p_replacement is not null then
    v_amount := coalesce((p_replacement ->> 'amount_minor_units')::bigint, v_original.amount_minor_units);

    select * into v_loan from public.loans where id = v_original.loan_id;
    v_principal_portion := floor((v_amount * v_loan.principal_minor_units) / v_loan.total_repayable_minor_units::numeric);
    v_interest_portion := v_amount - v_principal_portion;

    insert into public.repayments (
      group_id, loan_id, member_id, amount_minor_units, currency_code,
      principal_portion_minor_units, interest_portion_minor_units,
      received_at, payment_method, payment_reference, notes,
      status, reversal_of, reversal_reason, created_by
    ) values (
      v_original.group_id, v_original.loan_id, v_original.member_id, v_amount, v_original.currency_code,
      v_principal_portion, v_interest_portion,
      coalesce((p_replacement ->> 'received_at')::date, v_original.received_at),
      coalesce(p_replacement ->> 'payment_method', v_original.payment_method),
      coalesce(p_replacement ->> 'payment_reference', v_original.payment_reference),
      coalesce(p_replacement ->> 'notes', v_original.notes),
      'pending_verification', v_original.id, p_reason, v_uid
    )
    returning id into v_replacement_id;
  end if;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_original.group_id, v_uid, 'repayment_reversed', 'repayments', p_repayment_id,
    jsonb_build_object('reason', p_reason, 'replacement_id', v_replacement_id));

  return query select v_original.id, v_replacement_id;
end;
$$;

grant execute on function public.reverse_repayment(uuid, text, jsonb) to authenticated;
