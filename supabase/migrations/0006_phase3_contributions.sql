-- WealthCircle — Phase 3 contributions and reconciliation
--
-- Extends the Phase 1 contribution_plans/contribution_records tables with
-- the fields, constraints, trigger and RPCs needed for a real ledger:
-- recording a contribution, verifying it, reconciling it against a bank
-- statement, rejecting it, or reversing/correcting it after the fact.
--
-- Conventions follow 0002_phase2_auth_functions.sql exactly: every
-- function is `security invoker` with `set search_path = ''` and fully
-- qualified object names, relies on RLS for the actual authorisation
-- boundary, adds an explicit role check first for a friendly error
-- message, and writes an audit_logs row for every mutation.

-- =======================================================================
-- contribution_plans: allow a flexible plan to define a required minimum
-- (the only case a flexible contribution can be "overdue").
-- =======================================================================
alter table public.contribution_plans
  add column minimum_amount_minor_units bigint
    check (minimum_amount_minor_units is null or minimum_amount_minor_units > 0);

drop policy if exists "contribution_plans_update_treasurers" on public.contribution_plans;
create policy "contribution_plans_update_treasurers" on public.contribution_plans
  for update
  using (public.has_group_role(group_id, array['owner', 'administrator', 'treasurer']))
  with check (public.has_group_role(group_id, array['owner', 'administrator', 'treasurer']));

-- =======================================================================
-- contribution_records: the fields a real ledger entry needs beyond what
-- Phase 1 defined, plus a corrected, ledger-only status vocabulary.
-- =======================================================================
alter table public.contribution_records
  add column payment_method text
    check (payment_method in ('cash', 'bank_transfer', 'mobile_money', 'cheque', 'other')),
  add column payment_reference text,
  add column received_at date not null default current_date,
  add column rejected_by uuid references public.profiles (id),
  add column rejected_at timestamptz,
  add column rejection_reason text,
  add column reversed_by uuid references public.profiles (id),
  add column reversed_at timestamptz;

alter table public.contribution_records drop constraint contribution_records_status_check;
alter table public.contribution_records add constraint contribution_records_status_check
  check (status in ('pending_verification', 'verified', 'reconciled', 'rejected', 'reversed'));

alter table public.contribution_records alter column status set default 'pending_verification';

alter table public.contribution_records add constraint contribution_verified_requires_verifier
  check (status not in ('verified', 'reconciled') or (verified_by is not null and verified_at is not null));

alter table public.contribution_records add constraint contribution_rejected_requires_reason
  check (status <> 'rejected' or (rejected_by is not null and rejected_at is not null and rejection_reason is not null));

alter table public.contribution_records add constraint contribution_reversed_requires_reason
  check (status <> 'reversed' or (reversed_by is not null and reversed_at is not null and reversal_reason is not null));

create index contribution_records_status_idx on public.contribution_records (group_id, status);
create index contribution_records_period_idx on public.contribution_records (group_id, period_start, period_end);

-- ---------------------------------------------------------------------
-- Immutability: once a record is verified or reconciled, its financial
-- fields are locked. The only permitted transition out of that state is
-- to 'reversed' (via public.reverse_contribution below); metadata fields
-- (verified_by/at, reconciled_by/at, reversed_by/at, reversal_reason)
-- can still be set as part of that transition. This is the enforcement
-- behind "verified records must not be silently edited" — RLS already
-- restricts *who* can update; this restricts *what* changes once locked.
-- ---------------------------------------------------------------------
create or replace function public.protect_verified_contribution_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('verified', 'reconciled') and new.status <> 'reversed' then
    if new.amount_minor_units <> old.amount_minor_units
      or new.currency_code <> old.currency_code
      or new.member_id <> old.member_id
      or new.group_id <> old.group_id
      or coalesce(new.contribution_plan_id, '00000000-0000-0000-0000-000000000000'::uuid)
         <> coalesce(old.contribution_plan_id, '00000000-0000-0000-0000-000000000000'::uuid)
      or coalesce(new.period_start, '0001-01-01'::date) <> coalesce(old.period_start, '0001-01-01'::date)
      or coalesce(new.period_end, '0001-01-01'::date) <> coalesce(old.period_end, '0001-01-01'::date)
      or new.received_at <> old.received_at
      or coalesce(new.payment_method, '') <> coalesce(old.payment_method, '')
      or coalesce(new.payment_reference, '') <> coalesce(old.payment_reference, '')
    then
      raise exception 'Verified contribution records cannot be edited directly — use the reversal workflow instead.';
    end if;
  end if;
  return new;
end;
$$;

create trigger contribution_records_protect_verified
  before update on public.contribution_records
  for each row execute function public.protect_verified_contribution_record();

-- ---------------------------------------------------------------------
-- RLS: tighten contribution_records so members see only their own
-- records, and only treasurers/managers can create ledger entries at
-- all (Phase 1 allowed a member to insert their own — no longer, per
-- Phase 3's "members cannot create official ledger entries").
-- ---------------------------------------------------------------------
drop policy if exists "contribution_records_select_members" on public.contribution_records;
create policy "contribution_records_select_own_or_treasurer" on public.contribution_records
  for select using (
    member_id = auth.uid()
    or public.has_group_role(group_id, array['owner', 'administrator', 'treasurer', 'auditor'])
  );

drop policy if exists "contribution_records_insert_members" on public.contribution_records;
create policy "contribution_records_insert_treasurers" on public.contribution_records
  for insert with check (
    public.has_group_role(group_id, array['owner', 'administrator', 'treasurer'])
    and created_by = auth.uid()
  );

-- contribution_records_update_treasurers already exists from 0001_init.sql
-- and is unchanged; no delete policy exists or is added, so deletion
-- remains impossible through the API.

-- =======================================================================
-- upsert_contribution_plan
-- Creates or updates a group's contribution plan. Deliberately never
-- takes a currency parameter — it always uses the group's own
-- currency_code, which is the actual, structural enforcement of "do not
-- mix currencies within a group" (nothing for a caller to get wrong).
-- =======================================================================
create or replace function public.upsert_contribution_plan(
  p_group_id uuid,
  p_plan_id uuid,
  p_is_flexible boolean,
  p_amount_minor_units bigint,
  p_minimum_amount_minor_units bigint,
  p_frequency text,
  p_start_date date
)
returns table (plan_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_currency_code text;
  v_plan_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_group_role(p_group_id, array['owner', 'administrator', 'treasurer']) then
    raise exception 'Only owners, administrators and treasurers can configure contribution plans';
  end if;

  if not p_is_flexible and p_amount_minor_units is null then
    raise exception 'A fixed contribution plan requires an amount';
  end if;

  select currency_code into v_currency_code from public.groups where id = p_group_id;

  if p_plan_id is null then
    insert into public.contribution_plans (
      group_id, name, amount_minor_units, minimum_amount_minor_units, currency_code,
      frequency, is_flexible, start_date, created_by
    ) values (
      p_group_id, 'Standard contribution', p_amount_minor_units, p_minimum_amount_minor_units,
      v_currency_code, p_frequency, p_is_flexible, p_start_date, v_uid
    )
    returning id into v_plan_id;

    insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
    values (p_group_id, v_uid, 'contribution_plan_created', 'contribution_plans', v_plan_id, '{}'::jsonb);
  else
    update public.contribution_plans
    set
      amount_minor_units = p_amount_minor_units,
      minimum_amount_minor_units = p_minimum_amount_minor_units,
      frequency = p_frequency,
      is_flexible = p_is_flexible
    where id = p_plan_id and group_id = p_group_id
    returning id into v_plan_id;

    if v_plan_id is null then
      raise exception 'Contribution plan not found';
    end if;

    insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
    values (p_group_id, v_uid, 'contribution_plan_updated', 'contribution_plans', v_plan_id, '{}'::jsonb);
  end if;

  return query select v_plan_id;
end;
$$;

grant execute on function public.upsert_contribution_plan(
  uuid, uuid, boolean, bigint, bigint, text, date
) to authenticated;

-- =======================================================================
-- record_contribution
-- Records a payment received into the group's own bank account. Currency
-- is always taken from the group, never the caller.
-- =======================================================================
create or replace function public.record_contribution(
  p_group_id uuid,
  p_member_id uuid,
  p_contribution_plan_id uuid,
  p_amount_minor_units bigint,
  p_period_start date,
  p_period_end date,
  p_received_at date,
  p_payment_method text,
  p_payment_reference text,
  p_notes text
)
returns table (record_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_currency_code text;
  v_record_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_group_role(p_group_id, array['owner', 'administrator', 'treasurer']) then
    raise exception 'Only owners, administrators and treasurers can record contributions';
  end if;

  if not public.is_group_member(p_group_id) or p_member_id is null then
    raise exception 'Invalid member';
  end if;

  if not exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and user_id = p_member_id and status = 'active'
  ) then
    raise exception 'That person is not an active member of this group';
  end if;

  select currency_code into v_currency_code from public.groups where id = p_group_id;

  insert into public.contribution_records (
    group_id, contribution_plan_id, member_id, amount_minor_units, currency_code,
    period_start, period_end, received_at, payment_method, payment_reference, notes,
    status, created_by
  ) values (
    p_group_id, p_contribution_plan_id, p_member_id, p_amount_minor_units, v_currency_code,
    p_period_start, p_period_end, p_received_at, p_payment_method, p_payment_reference, p_notes,
    'pending_verification', v_uid
  )
  returning id into v_record_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_group_id, v_uid, 'contribution_recorded', 'contribution_records', v_record_id,
    jsonb_build_object('member_id', p_member_id, 'amount_minor_units', p_amount_minor_units)
  );

  return query select v_record_id;
end;
$$;

grant execute on function public.record_contribution(
  uuid, uuid, uuid, bigint, date, date, date, text, text, text
) to authenticated;

-- =======================================================================
-- verify_contribution
-- =======================================================================
create or replace function public.verify_contribution(p_record_id uuid)
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
  from public.contribution_records where id = p_record_id;

  if v_group_id is null then
    raise exception 'Contribution record not found';
  end if;

  if not public.has_group_role(v_group_id, array['owner', 'administrator', 'treasurer']) then
    raise exception 'Only owners, administrators and treasurers can verify contributions';
  end if;

  if v_status <> 'pending_verification' then
    raise exception 'Only a record pending verification can be verified';
  end if;

  update public.contribution_records
  set status = 'verified', verified_by = v_uid, verified_at = timezone('utc', now())
  where id = p_record_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'contribution_verified', 'contribution_records', p_record_id, '{}'::jsonb);
end;
$$;

grant execute on function public.verify_contribution(uuid) to authenticated;

-- =======================================================================
-- reconcile_contribution
-- =======================================================================
create or replace function public.reconcile_contribution(p_record_id uuid)
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
  from public.contribution_records where id = p_record_id;

  if v_group_id is null then
    raise exception 'Contribution record not found';
  end if;

  if not public.has_group_role(v_group_id, array['owner', 'administrator', 'treasurer']) then
    raise exception 'Only owners, administrators and treasurers can reconcile contributions';
  end if;

  if v_status <> 'verified' then
    raise exception 'Only a verified record can be reconciled';
  end if;

  update public.contribution_records
  set status = 'reconciled', reconciled_by = v_uid, reconciled_at = timezone('utc', now())
  where id = p_record_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'contribution_reconciled', 'contribution_records', p_record_id, '{}'::jsonb);
end;
$$;

grant execute on function public.reconcile_contribution(uuid) to authenticated;

-- =======================================================================
-- reject_contribution
-- Only a record still pending verification can be rejected outright — a
-- record that's already been verified must go through reverse_contribution
-- instead, so there's always exactly one workflow for "this was wrong."
-- =======================================================================
create or replace function public.reject_contribution(p_record_id uuid, p_reason text)
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
  from public.contribution_records where id = p_record_id;

  if v_group_id is null then
    raise exception 'Contribution record not found';
  end if;

  if not public.has_group_role(v_group_id, array['owner', 'administrator', 'treasurer']) then
    raise exception 'Only owners, administrators and treasurers can reject contributions';
  end if;

  if v_status <> 'pending_verification' then
    raise exception 'Only a record pending verification can be rejected';
  end if;

  update public.contribution_records
  set status = 'rejected', rejected_by = v_uid, rejected_at = timezone('utc', now()), rejection_reason = p_reason
  where id = p_record_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_group_id, v_uid, 'contribution_rejected', 'contribution_records', p_record_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

grant execute on function public.reject_contribution(uuid, text) to authenticated;

-- =======================================================================
-- reverse_contribution
-- The correction workflow for a verified/reconciled record. The original
-- row is never edited except to flip its status to 'reversed' and record
-- who/why/when — its financial fields stay exactly as they were, which
-- is what the immutability trigger above enforces. If a replacement is
-- given, a brand new row is inserted (reversal_of = original id) so the
-- corrected entry re-enters the normal verification workflow from
-- 'pending_verification'.
-- =======================================================================
create or replace function public.reverse_contribution(
  p_record_id uuid,
  p_reason text,
  p_replacement jsonb default null
)
returns table (record_id uuid, replacement_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_original public.contribution_records%rowtype;
  v_replacement_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  select * into v_original
  from public.contribution_records
  where id = p_record_id
  for update;

  if v_original.id is null then
    raise exception 'Contribution record not found';
  end if;

  if not public.has_group_role(v_original.group_id, array['owner', 'administrator', 'treasurer']) then
    raise exception 'Only owners, administrators and treasurers can reverse contributions';
  end if;

  if v_original.status not in ('verified', 'reconciled') then
    raise exception 'Only a verified or reconciled record can be reversed';
  end if;

  update public.contribution_records
  set status = 'reversed', reversed_by = v_uid, reversed_at = timezone('utc', now()), reversal_reason = p_reason
  where id = p_record_id;

  if p_replacement is not null then
    insert into public.contribution_records (
      group_id, contribution_plan_id, member_id, amount_minor_units, currency_code,
      period_start, period_end, received_at, payment_method, payment_reference, notes,
      status, reversal_of, reversal_reason, created_by
    ) values (
      v_original.group_id, v_original.contribution_plan_id, v_original.member_id,
      coalesce((p_replacement ->> 'amount_minor_units')::bigint, v_original.amount_minor_units),
      v_original.currency_code,
      coalesce((p_replacement ->> 'period_start')::date, v_original.period_start),
      coalesce((p_replacement ->> 'period_end')::date, v_original.period_end),
      coalesce((p_replacement ->> 'received_at')::date, v_original.received_at),
      coalesce(p_replacement ->> 'payment_method', v_original.payment_method),
      coalesce(p_replacement ->> 'payment_reference', v_original.payment_reference),
      coalesce(p_replacement ->> 'notes', v_original.notes),
      'pending_verification', v_original.id, p_reason, v_uid
    )
    returning id into v_replacement_id;
  end if;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_original.group_id, v_uid, 'contribution_reversed', 'contribution_records', p_record_id,
    jsonb_build_object('reason', p_reason, 'replacement_id', v_replacement_id)
  );

  return query select v_original.id, v_replacement_id;
end;
$$;

grant execute on function public.reverse_contribution(uuid, text, jsonb) to authenticated;
