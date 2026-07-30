-- WealthCircle — edit a still-pending contribution record
--
-- Fills a real gap in the Phase 3 ledger: a treasurer could previously
-- only reject-and-re-record or (after verification) reverse a mistaken
-- entry — there was no way to simply correct a typo in an amount/date/
-- reference before it's even been verified. RLS already allows a
-- treasurer+ to update a pending row directly (the immutability trigger
-- protect_verified_contribution_record() only locks verified/reconciled
-- rows — its `if` condition never fires for a pending one), but every
-- other mutation in this schema goes through an RPC specifically so it
-- writes an audit_logs row, and this is no different.
--
-- Idempotent: a single `create or replace function` plus `grant
-- execute`. Safe to run more than once.

create or replace function public.edit_contribution(
  p_record_id uuid,
  p_amount_minor_units bigint,
  p_period_start date,
  p_period_end date,
  p_received_at date,
  p_payment_method text,
  p_payment_reference text,
  p_notes text
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

  if p_amount_minor_units is null or p_amount_minor_units <= 0 then
    raise exception 'Enter an amount greater than zero';
  end if;

  select group_id, status into v_group_id, v_status
  from public.contribution_records
  where id = p_record_id;

  if v_group_id is null then
    raise exception 'Contribution record not found';
  end if;

  if not public.has_group_role(v_group_id, array['owner', 'administrator', 'treasurer']) then
    raise exception 'Only owners, administrators and treasurers can edit contributions';
  end if;

  if v_status <> 'pending_verification' then
    raise exception 'Only a record pending verification can be edited — use the reversal workflow for a verified or reconciled record instead';
  end if;

  update public.contribution_records
  set
    amount_minor_units = p_amount_minor_units,
    period_start = p_period_start,
    period_end = p_period_end,
    received_at = p_received_at,
    payment_method = p_payment_method,
    payment_reference = p_payment_reference,
    notes = p_notes
  where id = p_record_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'contribution_edited', 'contribution_records', p_record_id, '{}'::jsonb);
end;
$$;

grant execute on function public.edit_contribution(uuid, bigint, date, date, date, text, text, text) to authenticated;
