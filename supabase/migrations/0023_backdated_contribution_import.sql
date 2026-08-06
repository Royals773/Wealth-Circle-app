-- Lets a group onboard members' historical contributions — back-dated
-- records for a group that ran on paper before moving to the app.
-- Manager-only (owner/administrator — narrower than the treasurer-
-- inclusive record_contribution(), a deliberate choice for this
-- feature), with explicit provenance so a genuine contemporaneous
-- record and a back-dated reconstruction are never indistinguishable.
--
-- Deliberately reuses existing columns rather than adding parallel
-- ones: received_at is already "when the money actually changed
-- hands" (added in 0006, already wired into every eligibility/balance
-- calculation this schema does), created_at/created_by are already
-- "when the row was entered / by whom", and notes is already a free-
-- text field. Only genuinely new information gets a new column:
--   is_backdated   — true for every row entered through the two new
--                    paths below (manual + bulk), false for anything
--                    entered through the existing record_contribution()
--                    (unchanged, untouched by this migration) — the
--                    distinction is by entry path, not a fuzzy
--                    date-gap heuristic.
--   confirmed_by/confirmed_at — a lightweight, optional member
--                    acknowledgement that their imported history looks
--                    right, same spirit as constitution acknowledgement
--                    but 1:1 per row (a contribution record already
--                    belongs to exactly one member), not a separate
--                    join table.
--
-- Both new entry paths insert already-verified (status = 'verified',
-- verified_by/verified_at set to the acting admin) — this is an
-- authoritative admin assertion of group history, not a member
-- self-report awaiting a separate verification step, so it counts
-- toward loan eligibility / withdrawal balance / reports immediately,
-- exactly like any other verified contribution.

alter table public.contribution_records
  add column if not exists is_backdated boolean not null default false,
  add column if not exists confirmed_by uuid references public.profiles (id),
  add column if not exists confirmed_at timestamptz;

comment on column public.contribution_records.is_backdated is
  'True only for rows created via record_backdated_contribution()/bulk_import_contributions() — never set directly by record_contribution(). Distinguishes an authoritative historical reconstruction from a contemporaneous record.';
comment on column public.contribution_records.confirmed_by is
  'Set only via confirm_backdated_contribution(), by the member themselves, only for their own is_backdated rows. Optional — absence does not affect the record''s standing.';

-- =======================================================================
-- record_backdated_contribution: single manual entry. Owner/admin only.
-- =======================================================================
create or replace function public.record_backdated_contribution(
  p_group_id uuid,
  p_member_id uuid,
  p_amount_minor_units bigint,
  p_received_at date,
  p_note text default null,
  p_confirm_implausible_date boolean default false
)
returns table (record_id uuid, is_backdated boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_currency_code text;
  v_group_created_at date;
  v_record_id uuid;
  v_is_backdated boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_group_manager(p_group_id) then
    raise exception 'Only owners and administrators can record historical contributions';
  end if;
  if p_amount_minor_units is null or p_amount_minor_units <= 0 then
    raise exception 'Enter an amount greater than zero';
  end if;
  if p_received_at is null then
    raise exception 'A contribution date is required';
  end if;

  select currency_code, created_at::date into v_currency_code, v_group_created_at
  from public.groups where id = p_group_id;
  if v_currency_code is null then
    raise exception 'Group not found';
  end if;

  if not exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and user_id = p_member_id and status = 'active'
  ) then
    raise exception 'That person is not an active member of this group';
  end if;

  if (p_received_at > current_date or p_received_at < v_group_created_at)
     and not p_confirm_implausible_date then
    raise exception
      'IMPLAUSIBLE_DATE: % is % this group''s history — resubmit with confirmation if that''s correct',
      p_received_at,
      case when p_received_at > current_date then 'after today' else 'before the group existed' end;
  end if;

  v_is_backdated := p_received_at < current_date;

  insert into public.contribution_records (
    group_id, member_id, amount_minor_units, currency_code, received_at, notes,
    status, created_by, verified_by, verified_at, is_backdated
  ) values (
    p_group_id, p_member_id, p_amount_minor_units, v_currency_code, p_received_at, p_note,
    'verified', v_uid, v_uid, timezone('utc', now()), v_is_backdated
  )
  returning id into v_record_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_group_id, v_uid, 'contribution_backdated_recorded', 'contribution_records', v_record_id,
    jsonb_build_object('member_id', p_member_id, 'amount_minor_units', p_amount_minor_units, 'received_at', p_received_at)
  );

  perform public.create_notification(
    p_member_id, p_group_id, 'contribution', 'contribution_backdated_recorded',
    'A historical contribution was added to your record',
    'An administrator recorded a past contribution dated ' || to_char(p_received_at, 'DD Mon YYYY') ||
      '. You can review it and optionally confirm it looks correct.',
    'contribution_records', v_record_id, 'contribution_backdated_recorded:' || v_record_id
  );

  return query select v_record_id, v_is_backdated;
end;
$$;

revoke all on function public.record_backdated_contribution(uuid, uuid, bigint, date, text, boolean) from public;
grant execute on function public.record_backdated_contribution(uuid, uuid, bigint, date, text, boolean) to authenticated;

-- =======================================================================
-- bulk_import_contributions: CSV-style bulk entry. Owner/admin only.
--
-- p_rows is a jsonb array of {member_identifier, amount_minor_units,
-- received_at, note}. member_identifier is matched as a UUID (an
-- in-app member id) if it parses as one, otherwise as an email against
-- public.profiles — never free-text name matching, so a typo or a
-- duplicate name can never silently misassign someone else's
-- contribution. A row referencing someone who isn't an active member
-- of this group is rejected, never auto-created as one.
--
-- Each row runs in its own nested exception block (an implicit
-- savepoint) so one bad row is reported and skipped rather than
-- aborting the whole batch — "don't fail the whole file on one bad
-- row" from the spec, achieved with a real per-row rollback boundary,
-- not just a try/catch that still aborts the outer transaction.
--
-- p_dry_run lets the caller preview (member resolution, amounts,
-- dates, which rows would fail, and — since is_backdated is returned
-- per row — a client-computable summary) without writing anything;
-- the same validation logic runs either way, so preview and commit can
-- never disagree about what would happen.
-- =======================================================================
create or replace function public.bulk_import_contributions(
  p_group_id uuid,
  p_rows jsonb,
  p_confirm_implausible_dates boolean default false,
  p_dry_run boolean default false
)
returns table (
  row_index integer,
  success boolean,
  record_id uuid,
  member_identifier text,
  is_backdated boolean,
  error_message text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_currency_code text;
  v_group_created_at date;
  v_row jsonb;
  v_idx integer := 0;
  v_member_id uuid;
  v_amount bigint;
  v_received_at date;
  v_note text;
  v_identifier text;
  v_record_id uuid;
  v_is_backdated boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_group_manager(p_group_id) then
    raise exception 'Only owners and administrators can bulk-import contributions';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Malformed import file — expected a list of rows';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'The import file has no rows';
  end if;

  select currency_code, created_at::date into v_currency_code, v_group_created_at
  from public.groups where id = p_group_id;
  if v_currency_code is null then
    raise exception 'Group not found';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    begin
      v_identifier := nullif(trim(both from coalesce(v_row ->> 'member_identifier', '')), '');
      v_note := nullif(v_row ->> 'note', '');
      v_member_id := null;

      if v_identifier is null then
        raise exception 'Missing member identifier';
      end if;

      begin
        v_member_id := v_identifier::uuid;
      exception when invalid_text_representation then
        select id into v_member_id from public.profiles where lower(email) = lower(v_identifier);
      end;

      if v_member_id is null then
        raise exception 'No matching member found for "%"', v_identifier;
      end if;

      if not exists (
        select 1 from public.group_memberships
        where group_id = p_group_id and user_id = v_member_id and status = 'active'
      ) then
        raise exception '% is not an active member of this group', v_identifier;
      end if;

      begin
        v_amount := (v_row ->> 'amount_minor_units')::bigint;
      exception when others then
        raise exception 'Invalid amount';
      end;
      if v_amount is null or v_amount <= 0 then
        raise exception 'Amount must be greater than zero';
      end if;

      begin
        v_received_at := (v_row ->> 'received_at')::date;
      exception when others then
        raise exception 'Invalid date';
      end;
      if v_received_at is null then
        raise exception 'A contribution date is required';
      end if;

      if (v_received_at > current_date or v_received_at < v_group_created_at)
         and not p_confirm_implausible_dates then
        raise exception 'Implausible date % — outside the group''s history and not confirmed', v_received_at;
      end if;

      v_is_backdated := v_received_at < current_date;

      if not p_dry_run then
        insert into public.contribution_records (
          group_id, member_id, amount_minor_units, currency_code, received_at, notes,
          status, created_by, verified_by, verified_at, is_backdated
        ) values (
          p_group_id, v_member_id, v_amount, v_currency_code, v_received_at, v_note,
          'verified', v_uid, v_uid, timezone('utc', now()), v_is_backdated
        )
        returning id into v_record_id;

        insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
        values (
          p_group_id, v_uid, 'contribution_backdated_import', 'contribution_records', v_record_id,
          jsonb_build_object(
            'member_id', v_member_id, 'amount_minor_units', v_amount,
            'received_at', v_received_at, 'row_index', v_idx
          )
        );

        perform public.create_notification(
          v_member_id, p_group_id, 'contribution', 'contribution_backdated_recorded',
          'A historical contribution was added to your record',
          'An administrator imported a past contribution dated ' || to_char(v_received_at, 'DD Mon YYYY') ||
            '. You can review it and optionally confirm it looks correct.',
          'contribution_records', v_record_id, 'contribution_backdated_recorded:' || v_record_id
        );
      else
        v_record_id := null;
      end if;

      row_index := v_idx;
      success := true;
      record_id := v_record_id;
      member_identifier := v_identifier;
      is_backdated := v_is_backdated;
      error_message := null;
      return next;
    exception when others then
      row_index := v_idx;
      success := false;
      record_id := null;
      member_identifier := v_identifier;
      is_backdated := null;
      error_message := sqlerrm;
      return next;
    end;
  end loop;
  return;
end;
$$;

revoke all on function public.bulk_import_contributions(uuid, jsonb, boolean, boolean) from public;
grant execute on function public.bulk_import_contributions(uuid, jsonb, boolean, boolean) to authenticated;

-- =======================================================================
-- confirm_backdated_contribution: a member's own, optional acknowledgement
-- that their imported/back-dated history looks correct.
--
-- SECURITY DEFINER, not INVOKER: the table's existing UPDATE policy
-- (contribution_records_update_treasurers) only allows owner/
-- administrator/treasurer, not the member themselves, and RLS can't be
-- scoped to "only these two columns" — only to rows. The function body
-- is the real gate here (own row only, is_backdated rows only), the
-- same narrowly-scoped-function-bypassing-broader-RLS pattern already
-- used elsewhere in this schema (e.g. member_removal_blockers).
-- =======================================================================
create or replace function public.confirm_backdated_contribution(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member_id uuid;
  v_is_backdated boolean;
  v_group_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select member_id, is_backdated, group_id into v_member_id, v_is_backdated, v_group_id
  from public.contribution_records
  where id = p_record_id;

  if v_member_id is null then
    raise exception 'Contribution record not found';
  end if;
  if v_member_id <> v_uid then
    raise exception 'You can only confirm your own contribution history';
  end if;
  if not v_is_backdated then
    raise exception 'Only imported or back-dated records can be confirmed';
  end if;

  update public.contribution_records
  set confirmed_by = v_uid, confirmed_at = timezone('utc', now())
  where id = p_record_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'contribution_backdated_confirmed', 'contribution_records', p_record_id, '{}'::jsonb);
end;
$$;

revoke all on function public.confirm_backdated_contribution(uuid) from public;
grant execute on function public.confirm_backdated_contribution(uuid) to authenticated;
