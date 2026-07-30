-- WealthCircle — fix apply_for_loan()'s overdue-contributions check
--
-- Found during Phase 4 manual testing: the original check in
-- 0007_phase4_loans.sql flagged a member as having overdue contributions
-- if they had no verified contribution within roughly one period of
-- today — regardless of when they actually joined the group. A member
-- who joined very recently (so no period has elapsed for them yet) was
-- incorrectly blocked from applying for a loan, contradicting the
-- precise, join-date-aware calculation already used for the eligibility
-- *display* (src/lib/contributions.ts's computeMemberPeriodStatus,
-- which correctly treats a period as not_applicable if it ended before
-- the member joined). Fixed by adding the same join-date awareness to
-- this check: a member is only evaluated for overdue contributions once
-- they've been a member for at least one full period.
--
-- This migration is idempotent — it's a single `create or replace
-- function` and can be run any number of times safely.

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
  v_membership_joined_at timestamptz;
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

  select status, joined_at into v_membership_status, v_membership_joined_at
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

    -- Only evaluated once the member has actually been a member for at
    -- least one full period — otherwise a brand-new member with no
    -- chance to contribute yet would be wrongly flagged.
    select exists (
      select 1 from public.contribution_plans cp
      where cp.group_id = p_group_id and cp.status = 'active'
        and (cp.is_flexible = false or cp.minimum_amount_minor_units is not null)
        and v_membership_joined_at < (timezone('utc', now()) - make_interval(days => v_period_days))
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
