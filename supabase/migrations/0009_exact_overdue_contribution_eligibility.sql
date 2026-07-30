-- WealthCircle — exact calendar-period overdue-contribution eligibility
--
-- Replaces apply_for_loan()'s day-count approximation for the
-- overdue-CONTRIBUTIONS check (not the overdue-repayments check, which
-- is out of scope for this fix) with an exact port of
-- src/lib/contribution-periods.ts's period math and
-- src/lib/contributions.ts's computeMemberPeriodStatus logic — so the
-- server-side eligibility decision and the displayed overdue status can
-- never disagree.
--
-- Every function below is a faithful, line-by-line port of its
-- TypeScript counterpart:
--   add_months_clamped        <- addMonthsClamped
--   contribution_period_start <- periodStartForIndex
--   contribution_period_index <- getPeriodIndexContaining (estimate + the
--                                 same bounded correction walk)
--   contribution_period_end   <- periodForIndex's `end`
--   member_has_overdue_contributions <- the overdue-scanning loop that
--                                 mirrors computeMemberPeriodStatus,
--                                 called once per period since the
--                                 member's own join date
--
-- "Today" is Postgres's `current_date`, which reflects the database
-- session's TimeZone setting — Supabase projects default this to UTC,
-- matching every other date/timestamp convention already used
-- throughout this schema (timezone('utc', now()) for timestamps, plain
-- date columns with no per-row timezone for period/received_at values).
--
-- This migration is idempotent: every statement is `create or replace
-- function` (or a plain `create function` for genuinely new,
-- non-conflicting names — confirmed via the preflight query run before
-- this was finalized) plus `grant execute`. Safe to run more than once.

-- ---------------------------------------------------------------------
-- add_months_clamped: adds whole months to a date, clamping the day to
-- the target month's length (31 Jan + 1 month -> 28/29 Feb), always
-- anchored to the original date so repeated calls at different offsets
-- never compound drift from an earlier clamp.
-- ---------------------------------------------------------------------
create or replace function public.add_months_clamped(p_date date, p_months integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_first_of_target date;
  v_days_in_target integer;
  v_target_day integer;
begin
  v_first_of_target := (date_trunc('month', p_date) + make_interval(months => p_months))::date;
  v_days_in_target := extract(
    day from ((date_trunc('month', v_first_of_target) + interval '1 month') - interval '1 day')
  )::integer;
  v_target_day := least(extract(day from p_date)::integer, v_days_in_target);
  return v_first_of_target + (v_target_day - 1);
end;
$$;

grant execute on function public.add_months_clamped(date, integer) to authenticated;

-- ---------------------------------------------------------------------
-- contribution_period_start: the start date of the Nth period (0-based)
-- for a plan, given its start date and frequency.
-- ---------------------------------------------------------------------
create or replace function public.contribution_period_start(
  p_start_date date,
  p_frequency text,
  p_index integer
)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_frequency
    when 'weekly' then p_start_date + (7 * p_index)
    when 'biweekly' then p_start_date + (14 * p_index)
    when 'monthly' then public.add_months_clamped(p_start_date, p_index)
    when 'quarterly' then public.add_months_clamped(p_start_date, 3 * p_index)
    when 'annually' then public.add_months_clamped(p_start_date, 12 * p_index)
  end;
$$;

grant execute on function public.contribution_period_start(date, text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- contribution_period_index: the index of the period containing
-- p_target_date — an initial estimate (exact for weekly/biweekly, a
-- calendar-month difference for monthly/quarterly/annually) followed by
-- the same small, bounded correction walk as
-- getPeriodIndexContaining() in contribution-periods.ts, needed because
-- month-length clamping can make the estimate off by one at boundaries.
-- ---------------------------------------------------------------------
create or replace function public.contribution_period_index(
  p_start_date date,
  p_frequency text,
  p_target_date date
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_index integer;
  v_months integer;
begin
  if p_target_date <= p_start_date then
    return 0;
  end if;

  case p_frequency
    when 'weekly' then
      v_index := floor((p_target_date - p_start_date) / 7.0);
    when 'biweekly' then
      v_index := floor((p_target_date - p_start_date) / 14.0);
    when 'monthly' then
      v_index := (extract(year from p_target_date)::integer - extract(year from p_start_date)::integer) * 12
        + (extract(month from p_target_date)::integer - extract(month from p_start_date)::integer);
    when 'quarterly' then
      v_months := (extract(year from p_target_date)::integer - extract(year from p_start_date)::integer) * 12
        + (extract(month from p_target_date)::integer - extract(month from p_start_date)::integer);
      v_index := floor(v_months / 3.0);
    when 'annually' then
      v_index := extract(year from p_target_date)::integer - extract(year from p_start_date)::integer;
    else
      v_index := 0;
  end case;

  if v_index < 0 then
    v_index := 0;
  end if;

  while public.contribution_period_start(p_start_date, p_frequency, v_index + 1) <= p_target_date loop
    v_index := v_index + 1;
  end loop;
  while v_index > 0 and public.contribution_period_start(p_start_date, p_frequency, v_index) > p_target_date loop
    v_index := v_index - 1;
  end loop;

  return v_index;
end;
$$;

grant execute on function public.contribution_period_index(date, text, date) to authenticated;

-- ---------------------------------------------------------------------
-- contribution_period_end: the last day of the Nth period — one day
-- before the (N+1)th period starts.
-- ---------------------------------------------------------------------
create or replace function public.contribution_period_end(
  p_start_date date,
  p_frequency text,
  p_index integer
)
returns date
language sql
immutable
set search_path = ''
as $$
  select public.contribution_period_start(p_start_date, p_frequency, p_index + 1) - 1;
$$;

grant execute on function public.contribution_period_end(date, text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- member_has_overdue_contributions: scans every period from the later
-- of the plan's start date or the member's own join date, through
-- today, and returns true if any applicable period's verified total
-- fell short of the required amount after that period's end — the
-- exact same rule as computeMemberPeriodStatus() returning 'overdue' in
-- src/lib/contributions.ts, applied period-by-period. A flexible plan
-- with no minimum has nothing to be overdue against, matching
-- requiredAmountForPeriod() returning null. security invoker (the
-- default): relies on RLS on contribution_plans/contribution_records/
-- group_memberships for the caller's own visibility, same as every
-- other function in this schema.
-- ---------------------------------------------------------------------
create or replace function public.member_has_overdue_contributions(
  p_group_id uuid,
  p_member_id uuid,
  p_today date
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_plan public.contribution_plans%rowtype;
  v_joined_at date;
  v_effective_from date;
  v_required bigint;
  v_from_index integer;
  v_to_index integer;
  v_i integer;
  v_period_start date;
  v_period_end date;
  v_verified bigint;
begin
  select * into v_plan
  from public.contribution_plans
  where group_id = p_group_id and status = 'active'
  order by created_at desc
  limit 1;

  if v_plan.id is null then
    return false;
  end if;

  if v_plan.is_flexible and v_plan.minimum_amount_minor_units is null then
    return false;
  end if;

  v_required := case when v_plan.is_flexible then v_plan.minimum_amount_minor_units else v_plan.amount_minor_units end;

  select joined_at::date into v_joined_at
  from public.group_memberships
  where group_id = p_group_id and user_id = p_member_id;

  if v_joined_at is null then
    return false;
  end if;

  v_effective_from := greatest(v_plan.start_date, v_joined_at);

  if p_today < v_effective_from then
    return false;
  end if;

  v_from_index := public.contribution_period_index(v_plan.start_date, v_plan.frequency, v_effective_from);
  v_to_index := public.contribution_period_index(v_plan.start_date, v_plan.frequency, p_today);

  for v_i in v_from_index..v_to_index loop
    v_period_start := public.contribution_period_start(v_plan.start_date, v_plan.frequency, v_i);
    v_period_end := public.contribution_period_end(v_plan.start_date, v_plan.frequency, v_i);

    if v_period_end < v_joined_at then
      continue;
    end if;

    select coalesce(sum(amount_minor_units), 0) into v_verified
    from public.contribution_records
    where group_id = p_group_id and member_id = p_member_id
      and status in ('verified', 'reconciled')
      and period_start = v_period_start;

    if v_verified < v_required and p_today > v_period_end then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

grant execute on function public.member_has_overdue_contributions(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- apply_for_loan: identical to the version in
-- 0008_fix_apply_for_loan_overdue_check.sql except the
-- overdue-contributions check now calls member_has_overdue_contributions()
-- instead of the day-count approximation. The overdue-repayments check
-- is unchanged (out of scope for this fix).
-- ---------------------------------------------------------------------
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

  if not v_product.allow_overdue_members then
    v_period_days := case v_product.repayment_frequency
      when 'weekly' then 7
      when 'biweekly' then 14
      when 'monthly' then 30
      when 'quarterly' then 90
      else 365
    end;

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

    if public.member_has_overdue_contributions(p_group_id, v_uid, current_date) then
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
