-- WealthCircle — Phase 8 reports, notifications and audit
--
-- notifications and audit_logs have existed since the Phase 1 schema.
-- audit_logs has been fully wired since Phase 2; notifications has never
-- had a single row inserted by any code path until this migration.
-- Reports need no schema changes at all — they're computed live from
-- existing tables via shared TypeScript loaders (src/lib/data/), so
-- everything below is entirely about notifications and their delivery.
--
-- IDEMPOTENT: every statement is guarded (if not exists / if exists /
-- create or replace / drop-then-add), the discipline established in
-- Phase 6/7 after 0011 needed a follow-up. Safe to run more than once.
--
-- Architecture (see docs/security-boundaries.md for the full reasoning):
--   - create_notification() is a new narrowly-scoped SECURITY DEFINER
--     helper, justified the same way member_removal_blockers() is: it
--     writes a row for a recipient who usually isn't the caller, which
--     no sane RLS policy should allow generally. Idempotent via a
--     dedupe_key column with a partial unique index — every call site
--     below passes a key scoped to the specific event, so retries and
--     the reminder functions re-running can never create duplicate rows.
--   - Every existing lifecycle RPC that should notify someone gets one
--     additive `perform public.create_notification(...)` call, right
--     next to its existing `insert into audit_logs` line. Nothing about
--     any RPC's existing behaviour, checks, or error messages changes.
--   - Postgres can't send email. claim_pending_notification_emails() and
--     mark_notification_email_result() are the two narrow, SECURITY
--     DEFINER seams the Next.js layer uses to actually deliver mail via
--     Mailtrap — see src/lib/email/. SUPABASE_SECRET_KEY is still never
--     referenced anywhere under src/ for this.
--   - notification_preferences gates EMAIL only, never the in-app
--     notification. 'membership' and 'ownership_transfer' are essential
--     categories and always email regardless of preference.

-- =======================================================================
-- notifications: add category/dedupe/email-delivery columns
-- =======================================================================
alter table public.notifications
  add column if not exists category text,
  add column if not exists dedupe_key text,
  add column if not exists email_status text not null default 'not_required'
    check (email_status in ('not_required', 'pending', 'sending', 'sent', 'failed')),
  add column if not exists email_attempted_at timestamptz,
  add column if not exists email_error text;

create unique index if not exists notifications_recipient_dedupe_key_idx
  on public.notifications (recipient_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_id, is_read, created_at desc);

create index if not exists notifications_email_pending_idx
  on public.notifications (email_status)
  where email_status = 'pending';

-- =======================================================================
-- notification_preferences — always the caller's own row; no
-- SECURITY DEFINER needed anywhere here. Absence of a row for a given
-- category means "enabled" (the default), so existing users need no
-- backfill.
-- =======================================================================
create table if not exists public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null,
  email_enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, category)
);

drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;

drop policy if exists "notification_preferences_select_self" on public.notification_preferences;
create policy "notification_preferences_select_self" on public.notification_preferences
  for select using (user_id = auth.uid());

drop policy if exists "notification_preferences_insert_self" on public.notification_preferences;
create policy "notification_preferences_insert_self" on public.notification_preferences
  for insert with check (user_id = auth.uid());

drop policy if exists "notification_preferences_update_self" on public.notification_preferences;
create policy "notification_preferences_update_self" on public.notification_preferences
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =======================================================================
-- create_notification
-- SECURITY DEFINER: writes a notification for a recipient who usually
-- isn't the caller. Decides email eligibility itself (essential
-- categories always email; others check the recipient's own
-- preference, defaulting to enabled). Idempotent: returns the existing
-- row's id (no-op) rather than erroring on a repeat dedupe_key.
-- =======================================================================
create or replace function public.create_notification(
  p_recipient_id uuid,
  p_group_id uuid,
  p_category text,
  p_type text,
  p_title text,
  p_body text,
  p_related_type text,
  p_related_id uuid,
  p_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_enabled boolean;
  v_essential boolean;
  v_id uuid;
begin
  if p_recipient_id is null then
    return null;
  end if;

  v_essential := p_category in ('membership', 'ownership_transfer');

  if v_essential then
    v_email_enabled := true;
  else
    select np.email_enabled into v_email_enabled
    from public.notification_preferences np
    where np.user_id = p_recipient_id and np.category = p_category;
    v_email_enabled := coalesce(v_email_enabled, true);
  end if;

  insert into public.notifications (
    recipient_id, group_id, category, type, title, body, related_type, related_id,
    dedupe_key, email_status
  ) values (
    p_recipient_id, p_group_id, p_category, p_type, p_title, p_body, p_related_type, p_related_id,
    p_dedupe_key, case when v_email_enabled then 'pending' else 'not_required' end
  )
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_notification(
  uuid, uuid, text, text, text, text, text, uuid, text
) to authenticated;

-- =======================================================================
-- claim_pending_notification_emails
-- SECURITY DEFINER, narrowly scoped: atomically claims a batch of
-- pending emails (flips them to 'sending' so no two flush calls can
-- send the same one) and returns only what's needed to send the email —
-- never the notification body, which stays in-app only. Bounded to
-- notifications whose recipient shares a group with the caller (or is
-- account-level), the same kind of narrowing member_removal_blockers()
-- already uses, so this can't become a way to browse arbitrary
-- strangers' notifications.
-- =======================================================================
create or replace function public.claim_pending_notification_emails(p_limit integer default 10)
returns table (
  notification_id uuid,
  recipient_email text,
  subject text,
  action_path text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  return query
  with claimed as (
    update public.notifications n
    set email_status = 'sending', email_attempted_at = timezone('utc', now())
    where n.id in (
      select n2.id
      from public.notifications n2
      where n2.email_status = 'pending'
        and (
          n2.group_id is null
          or exists (
            select 1
            from public.group_memberships caller_gm
            join public.group_memberships recipient_gm
              on recipient_gm.group_id = caller_gm.group_id
            where caller_gm.user_id = v_uid
              and recipient_gm.user_id = n2.recipient_id
          )
        )
      order by n2.created_at
      limit p_limit
      for update skip locked
    )
    returning n.id, n.recipient_id, n.title, n.group_id
  )
  select
    c.id,
    p.email,
    c.title,
    case when c.group_id is not null then '/dashboard/' || c.group_id::text || '/notifications' else '/dashboard' end
  from claimed c
  join public.profiles p on p.id = c.recipient_id;
end;
$$;

grant execute on function public.claim_pending_notification_emails(integer) to authenticated;

-- =======================================================================
-- mark_notification_email_result
-- SECURITY DEFINER, narrowly scoped: only transitions a row already
-- 'sending' (i.e. one actually claimed above), and only ever to 'sent'
-- or 'failed'.
-- =======================================================================
create or replace function public.mark_notification_email_result(
  p_notification_id uuid,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_status not in ('sent', 'failed') then
    raise exception 'Invalid status';
  end if;

  update public.notifications
  set email_status = p_status, email_attempted_at = timezone('utc', now()), email_error = p_error
  where id = p_notification_id and email_status = 'sending';
end;
$$;

grant execute on function public.mark_notification_email_result(uuid, text, text) to authenticated;

-- =======================================================================
-- Scheduled reminder / expiry functions — all SECURITY DEFINER (they
-- scan across every group, not just the caller's), all idempotent via
-- create_notification()'s dedupe_key. Tested by calling directly with
-- the admin client already used for test setup/teardown — never from
-- application code, so SUPABASE_SECRET_KEY still never appears under
-- src/. Phase 9's job: point pg_cron or an external scheduler at these.
-- =======================================================================
create or replace function public.send_overdue_contribution_reminders(p_today date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_member record;
begin
  for v_member in
    select gm.group_id, gm.user_id, g.name as group_name
    from public.group_memberships gm
    join public.groups g on g.id = gm.group_id
    where gm.status = 'active'
  loop
    if public.member_has_overdue_contributions(v_member.group_id, v_member.user_id, p_today) then
      if public.create_notification(
        v_member.user_id, v_member.group_id, 'contribution', 'contribution_overdue',
        'You have an overdue contribution in ' || v_member.group_name,
        'One or more of your contribution periods in ' || v_member.group_name
          || ' is overdue. Sign in to review and make it up.',
        'contribution_records', null,
        'overdue_contribution:' || v_member.user_id || ':' || v_member.group_id || ':' || p_today
      ) is not null then
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.send_overdue_contribution_reminders(date) to authenticated;

create or replace function public.send_overdue_repayment_reminders(p_today date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_loan record;
  v_period_days integer;
begin
  for v_loan in
    select l.id, l.group_id, l.borrower_id, l.disbursed_at, l.repayment_frequency, g.name as group_name,
           coalesce(lp.grace_period_days, 0) as grace_period_days
    from public.loans l
    join public.groups g on g.id = l.group_id
    left join public.loan_products lp on lp.group_id = l.group_id and lp.status = 'active'
    where l.status = 'active'
  loop
    v_period_days := case v_loan.repayment_frequency
      when 'weekly' then 7
      when 'biweekly' then 14
      when 'monthly' then 30
      when 'quarterly' then 90
      else 365
    end;

    if v_loan.disbursed_at < (timezone('utc', now()) - make_interval(days => v_period_days))
      and not exists (
        select 1 from public.repayments r
        where r.loan_id = v_loan.id and r.status in ('verified', 'reconciled')
          and r.received_at > (p_today - (v_period_days + v_loan.grace_period_days))
      )
    then
      if public.create_notification(
        v_loan.borrower_id, v_loan.group_id, 'repayment', 'repayment_overdue',
        'You have an overdue loan repayment in ' || v_loan.group_name,
        'Your loan repayment in ' || v_loan.group_name || ' is overdue. Sign in to review your schedule.',
        'loans', v_loan.id, 'overdue_repayment:' || v_loan.id || ':' || p_today
      ) is not null then
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.send_overdue_repayment_reminders(date) to authenticated;

create or replace function public.send_governance_deadline_reminders(p_now timestamptz default timezone('utc', now()))
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_proposal record;
  v_voter record;
begin
  -- Approaching deadline: open proposals closing within 24h, notify
  -- eligible members who haven't voted yet.
  for v_proposal in
    select gp.id, gp.group_id, gp.title, gp.voting_opens_at, gp.voting_closes_at, g.name as group_name
    from public.governance_proposals gp
    join public.groups g on g.id = gp.group_id
    where gp.status = 'open'
      and gp.voting_opens_at <= p_now
      and gp.voting_closes_at > p_now
      and gp.voting_closes_at <= p_now + interval '24 hours'
  loop
    for v_voter in
      select gm.user_id
      from public.group_memberships gm
      where gm.group_id = v_proposal.group_id and gm.status = 'active'
        and gm.joined_at <= v_proposal.voting_opens_at
        and not exists (
          select 1 from public.votes v where v.proposal_id = v_proposal.id and v.voter_id = gm.user_id
        )
    loop
      if public.create_notification(
        v_voter.user_id, v_proposal.group_id, 'governance', 'governance_deadline_approaching',
        'Voting closes soon on "' || v_proposal.title || '" in ' || v_proposal.group_name,
        'Voting closes ' || to_char(v_proposal.voting_closes_at, 'DD Mon YYYY HH24:MI') || ' UTC. Sign in to cast your vote.',
        'governance_proposals', v_proposal.id, 'governance_deadline:' || v_proposal.id || ':' || v_voter.user_id
      ) is not null then
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;

  -- Completed: voting just closed, notify the proposer (full results are
  -- already visible in-app to every member per Phase 6 — no group-wide
  -- fan-out needed to satisfy this).
  for v_proposal in
    select gp.id, gp.group_id, gp.title, gp.proposed_by, g.name as group_name
    from public.governance_proposals gp
    join public.groups g on g.id = gp.group_id
    where gp.status = 'open' and gp.voting_closes_at <= p_now
  loop
    if public.create_notification(
      v_proposal.proposed_by, v_proposal.group_id, 'governance', 'governance_completed',
      'Voting has closed on "' || v_proposal.title || '" in ' || v_proposal.group_name,
      'The result is now visible in ' || v_proposal.group_name || '.',
      'governance_proposals', v_proposal.id, 'governance_completed:' || v_proposal.id
    ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.send_governance_deadline_reminders(timestamptz) to authenticated;

create or replace function public.expire_stale_invitations(p_now timestamptz default timezone('utc', now()))
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_invite record;
begin
  for v_invite in
    select gi.id, gi.group_id, gi.invited_by, gi.email, g.name as group_name
    from public.group_invitations gi
    join public.groups g on g.id = gi.group_id
    where gi.status = 'pending' and gi.expires_at < p_now
  loop
    update public.group_invitations set status = 'expired' where id = v_invite.id;

    if public.create_notification(
      v_invite.invited_by, v_invite.group_id, 'invitation', 'invitation_expired',
      'Your invitation to ' || v_invite.email || ' expired in ' || v_invite.group_name,
      'The invitation sent to ' || v_invite.email || ' was never accepted and has now expired.',
      'group_invitations', v_invite.id, 'invitation_expired:' || v_invite.id
    ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.expire_stale_invitations(timestamptz) to authenticated;

create or replace function public.expire_stale_ownership_transfers(p_now timestamptz default timezone('utc', now()))
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_transfer record;
begin
  for v_transfer in
    select ot.id, ot.group_id, ot.from_user_id, ot.to_user_id, g.name as group_name
    from public.ownership_transfers ot
    join public.groups g on g.id = ot.group_id
    where ot.status = 'pending' and ot.expires_at < p_now
  loop
    update public.ownership_transfers set status = 'expired' where id = v_transfer.id;

    if public.create_notification(
      v_transfer.from_user_id, v_transfer.group_id, 'ownership_transfer', 'ownership_transfer_expired',
      'Your ownership transfer request expired in ' || v_transfer.group_name,
      'The pending ownership transfer in ' || v_transfer.group_name || ' was not accepted in time and has expired.',
      'ownership_transfers', v_transfer.id, 'ownership_transfer_expired:' || v_transfer.id
    ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.expire_stale_ownership_transfers(timestamptz) to authenticated;

-- =======================================================================
-- Invitations (0002_phase2_auth_functions.sql) — accept_invitation and
-- revoke_invitation each gain one additive notification call to the
-- inviter (invited_by). Every other line is unchanged from the current
-- live function.
-- =======================================================================
create or replace function public.accept_invitation(p_token text)
returns table (group_id uuid, role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user_email text;
  v_invitation public.group_invitations%rowtype;
  v_token_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invitation
  from public.group_invitations
  where token_hash = v_token_hash
  for update;

  if not found then
    raise exception 'This invitation is invalid.';
  end if;

  if v_invitation.status = 'accepted' then
    raise exception 'This invitation has already been used.';
  end if;

  if v_invitation.status = 'revoked' then
    raise exception 'This invitation has been revoked.';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'This invitation is no longer available.';
  end if;

  if v_invitation.expires_at < timezone('utc', now()) then
    update public.group_invitations set status = 'expired' where id = v_invitation.id;
    raise exception 'This invitation has expired.';
  end if;

  select email into v_user_email from auth.users where id = v_uid;

  if v_user_email is null or lower(v_user_email) <> lower(v_invitation.email) then
    raise exception 'This invitation was sent to a different email address.';
  end if;

  if exists (
    select 1 from public.group_memberships
    where group_id = v_invitation.group_id and user_id = v_uid
  ) then
    raise exception 'You are already a member of this group.';
  end if;

  insert into public.group_memberships (group_id, user_id, role, status)
  values (v_invitation.group_id, v_uid, v_invitation.role, 'active');

  update public.group_invitations
  set status = 'accepted', accepted_at = timezone('utc', now()), accepted_by = v_uid
  where id = v_invitation.id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_invitation.group_id, v_uid, 'invitation_accepted', 'group_invitations', v_invitation.id,
    jsonb_build_object('role', v_invitation.role)
  );

  select name into v_group_name from public.groups where id = v_invitation.group_id;
  perform public.create_notification(
    v_invitation.invited_by, v_invitation.group_id, 'invitation', 'invitation_accepted',
    'Your invitation to ' || v_invitation.email || ' was accepted in ' || coalesce(v_group_name, 'your group'),
    v_invitation.email || ' has joined ' || coalesce(v_group_name, 'your group') || ' as ' || v_invitation.role || '.',
    'group_invitations', v_invitation.id, 'invitation_accepted:' || v_invitation.id
  );

  return query select v_invitation.group_id, v_invitation.role;
end;
$$;

grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_status text;
  v_invited_by uuid;
  v_email text;
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select group_id, status, invited_by, email into v_group_id, v_status, v_invited_by, v_email
  from public.group_invitations
  where id = p_invitation_id;

  if v_group_id is null then
    raise exception 'Invitation not found';
  end if;

  if not public.is_group_manager(v_group_id) then
    raise exception 'Only group owners and administrators can revoke invitations';
  end if;

  if v_status <> 'pending' then
    raise exception 'Only a pending invitation can be revoked';
  end if;

  update public.group_invitations
  set status = 'revoked'
  where id = p_invitation_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_group_id, v_uid, 'invitation_revoked', 'group_invitations', p_invitation_id, '{}'::jsonb);

  select name into v_group_name from public.groups where id = v_group_id;
  perform public.create_notification(
    v_invited_by, v_group_id, 'invitation', 'invitation_revoked',
    'Your invitation to ' || v_email || ' was revoked in ' || coalesce(v_group_name, 'your group'),
    'The invitation sent to ' || v_email || ' in ' || coalesce(v_group_name, 'your group') || ' has been revoked.',
    'group_invitations', p_invitation_id, 'invitation_revoked:' || p_invitation_id
  );
end;
$$;

grant execute on function public.revoke_invitation(uuid) to authenticated;

-- =======================================================================
-- Contributions (0006_phase3_contributions.sql) — record_contribution,
-- verify_contribution, reject_contribution and reverse_contribution each
-- gain one additive notification call to the contributing member. Every
-- other line is unchanged from the current live function.
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
  v_group_name text;
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

  select name into v_group_name from public.groups where id = p_group_id;
  perform public.create_notification(
    p_member_id, p_group_id, 'contribution', 'contribution_recorded',
    'A contribution was recorded for you in ' || coalesce(v_group_name, 'your group'),
    'A contribution has been recorded on your behalf and is awaiting verification.',
    'contribution_records', v_record_id, 'contribution_recorded:' || v_record_id
  );

  return query select v_record_id;
end;
$$;

grant execute on function public.record_contribution(
  uuid, uuid, uuid, bigint, date, date, date, text, text, text
) to authenticated;

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
  v_member_id uuid;
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select group_id, status, member_id into v_group_id, v_status, v_member_id
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

  select name into v_group_name from public.groups where id = v_group_id;
  perform public.create_notification(
    v_member_id, v_group_id, 'contribution', 'contribution_verified',
    'Your contribution was verified in ' || coalesce(v_group_name, 'your group'),
    'A contribution recorded on your behalf has been verified.',
    'contribution_records', p_record_id, 'contribution_verified:' || p_record_id
  );
end;
$$;

grant execute on function public.verify_contribution(uuid) to authenticated;

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
  v_member_id uuid;
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  select group_id, status, member_id into v_group_id, v_status, v_member_id
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

  select name into v_group_name from public.groups where id = v_group_id;
  perform public.create_notification(
    v_member_id, v_group_id, 'contribution', 'contribution_rejected',
    'Your contribution was rejected in ' || coalesce(v_group_name, 'your group'),
    'A contribution recorded on your behalf was rejected: ' || p_reason,
    'contribution_records', p_record_id, 'contribution_rejected:' || p_record_id
  );
end;
$$;

grant execute on function public.reject_contribution(uuid, text) to authenticated;

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
  v_group_name text;
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

  select name into v_group_name from public.groups where id = v_original.group_id;
  perform public.create_notification(
    v_original.member_id, v_original.group_id, 'contribution', 'contribution_reversed',
    'Your contribution was reversed in ' || coalesce(v_group_name, 'your group'),
    'A contribution recorded on your behalf was reversed: ' || p_reason,
    'contribution_records', p_record_id, 'contribution_reversed:' || p_record_id
  );

  return query select v_original.id, v_replacement_id;
end;
$$;

grant execute on function public.reverse_contribution(uuid, text, jsonb) to authenticated;

-- =======================================================================
-- Loans and repayments (0007_phase4_loans.sql, apply_for_loan superseded
-- by 0009_exact_overdue_contribution_eligibility.sql) — each gains one
-- additive notification call. apply_for_loan notifies the group's loan
-- officers (owner/administrator/loan_officer) that a new application
-- needs review — a fan-out loop, bounded by officer headcount. Every
-- other line is unchanged from the current live function.
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
  v_has_overdue_repayments boolean := false;
  v_application_id uuid;
  v_group_name text;
  v_officer record;
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

  select name into v_group_name from public.groups where id = p_group_id;
  for v_officer in
    select user_id from public.group_memberships
    where group_id = p_group_id and status = 'active'
      and role in ('owner', 'administrator', 'loan_officer') and user_id <> v_uid
  loop
    perform public.create_notification(
      v_officer.user_id, p_group_id, 'loan', 'loan_application_submitted',
      'A new loan application needs review in ' || coalesce(v_group_name, 'your group'),
      'A member has applied for a loan and it is awaiting your review.',
      'loan_applications', v_application_id, 'loan_application_submitted:' || v_application_id || ':' || v_officer.user_id
    );
  end loop;

  return query select v_application_id;
exception
  when unique_violation then
    raise exception 'You already have an application awaiting a decision for this group';
end;
$$;

grant execute on function public.apply_for_loan(uuid, bigint, integer, text) to authenticated;

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
  v_group_name text;
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

  select name into v_group_name from public.groups where id = v_application.group_id;

  if p_decision = 'rejected' then
    update public.loan_applications
    set status = 'rejected', reviewed_by = v_uid, reviewed_at = timezone('utc', now()), decision_notes = p_notes
    where id = p_application_id;

    insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_application.group_id, v_uid, 'loan_application_rejected', 'loan_applications', p_application_id,
      jsonb_build_object('reason', p_notes));

    perform public.create_notification(
      v_application.applicant_id, v_application.group_id, 'loan', 'loan_application_rejected',
      'Your loan application was rejected in ' || coalesce(v_group_name, 'your group'),
      coalesce('Reason: ' || p_notes, 'Your loan application was not approved.'),
      'loan_applications', p_application_id, 'loan_application_rejected:' || p_application_id
    );

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

  perform public.create_notification(
    v_application.applicant_id, v_application.group_id, 'loan', 'loan_application_approved',
    'Your loan application was approved in ' || coalesce(v_group_name, 'your group'),
    'Your loan has been approved and is awaiting disbursement.',
    'loan_applications', p_application_id, 'loan_application_approved:' || p_application_id
  );

  return query select p_application_id, v_loan_id;
end;
$$;

grant execute on function public.decide_loan_application(
  uuid, text, bigint, integer, integer, text, text
) to authenticated;

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
  v_borrower_id uuid;
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select group_id, status, borrower_id into v_group_id, v_status, v_borrower_id
  from public.loans where id = p_loan_id;

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

  select name into v_group_name from public.groups where id = v_group_id;
  perform public.create_notification(
    v_borrower_id, v_group_id, 'loan', 'loan_disbursed',
    'Your loan was disbursed in ' || coalesce(v_group_name, 'your group'),
    'Your loan has been marked as disbursed on ' || p_disbursement_date || '.',
    'loans', p_loan_id, 'loan_disbursed:' || p_loan_id
  );
end;
$$;

grant execute on function public.record_disbursement(uuid, date, text, text) to authenticated;

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
  v_group_name text;
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

  select name into v_group_name from public.groups where id = v_loan.group_id;
  perform public.create_notification(
    v_loan.borrower_id, v_loan.group_id, 'repayment', 'repayment_recorded',
    'A repayment was recorded on your loan in ' || coalesce(v_group_name, 'your group'),
    'A repayment has been recorded on your loan and is awaiting verification.',
    'repayments', v_repayment_id, 'repayment_recorded:' || v_repayment_id
  );

  return query select v_repayment_id;
end;
$$;

grant execute on function public.record_repayment(uuid, bigint, date, text, text, text) to authenticated;

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
  v_member_id uuid;
  v_loan_id uuid;
  v_group_name text;
  v_loan public.loans%rowtype;
  v_outstanding bigint;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select group_id, status, member_id, loan_id into v_group_id, v_status, v_member_id, v_loan_id
  from public.repayments where id = p_repayment_id;

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

  select name into v_group_name from public.groups where id = v_group_id;
  perform public.create_notification(
    v_member_id, v_group_id, 'repayment', 'repayment_verified',
    'Your loan repayment was verified in ' || coalesce(v_group_name, 'your group'),
    'A repayment on your loan has been verified.',
    'repayments', p_repayment_id, 'repayment_verified:' || p_repayment_id
  );

  -- Fully repaid: outstanding principal already reflects this repayment,
  -- since it just moved to 'verified' above and the sum below includes
  -- verified/reconciled statuses.
  select * into v_loan from public.loans where id = v_loan_id;
  if v_loan.id is not null then
    select v_loan.principal_minor_units - coalesce(sum(r.principal_portion_minor_units), 0) into v_outstanding
    from public.repayments r
    where r.loan_id = v_loan_id and r.status in ('verified', 'reconciled');

    if v_outstanding <= 0 then
      perform public.create_notification(
        v_member_id, v_group_id, 'loan', 'loan_fully_repaid',
        'Your loan is fully repaid in ' || coalesce(v_group_name, 'your group'),
        'Congratulations — your loan has now been fully repaid.',
        'loans', v_loan_id, 'loan_fully_repaid:' || v_loan_id
      );
    end if;
  end if;
end;
$$;

grant execute on function public.verify_repayment(uuid) to authenticated;

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
  v_member_id uuid;
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  select group_id, status, member_id into v_group_id, v_status, v_member_id
  from public.repayments where id = p_repayment_id;

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

  select name into v_group_name from public.groups where id = v_group_id;
  perform public.create_notification(
    v_member_id, v_group_id, 'repayment', 'repayment_rejected',
    'Your loan repayment was rejected in ' || coalesce(v_group_name, 'your group'),
    'A repayment on your loan was rejected: ' || p_reason,
    'repayments', p_repayment_id, 'repayment_rejected:' || p_repayment_id
  );
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
  v_group_name text;
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

  select name into v_group_name from public.groups where id = v_original.group_id;
  perform public.create_notification(
    v_original.member_id, v_original.group_id, 'repayment', 'repayment_reversed',
    'A loan repayment was reversed in ' || coalesce(v_group_name, 'your group'),
    'A repayment on your loan was reversed: ' || p_reason,
    'repayments', p_repayment_id, 'repayment_reversed:' || p_repayment_id
  );

  return query select v_original.id, v_replacement_id;
end;
$$;

grant execute on function public.reverse_repayment(uuid, text, jsonb) to authenticated;

-- =======================================================================
-- Withdrawals and governance (0011_phase6_withdrawals_governance.sql) —
-- request_withdrawal fans out to the group's configured reviewers;
-- decide_withdrawal_request/confirm_withdrawal_payment/
-- reverse_withdrawal_payment notify the requester;
-- create_governance_proposal fans out to every eligible active member.
-- Every other line is unchanged from the current live function.
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
  v_group_name text;
  v_reviewer record;
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

  select name into v_group_name from public.groups where id = p_group_id;
  for v_reviewer in
    select user_id from public.group_memberships
    where group_id = p_group_id and status = 'active'
      and role = any(v_policy.reviewer_roles) and user_id <> v_uid
  loop
    perform public.create_notification(
      v_reviewer.user_id, p_group_id, 'withdrawal', 'withdrawal_requested',
      'A withdrawal request needs review in ' || coalesce(v_group_name, 'your group'),
      'A member has requested a withdrawal and it is awaiting your review.',
      'withdrawal_requests', v_request_id, 'withdrawal_requested:' || v_request_id || ':' || v_reviewer.user_id
    );
  end loop;

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
  v_group_name text;
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

  select name into v_group_name from public.groups where id = v_request.group_id;

  if p_decision = 'rejected' then
    update public.withdrawal_requests
      set status = 'rejected', reviewed_by = v_uid, reviewed_at = timezone('utc', now()), decision_notes = p_notes
      where id = p_request_id;
    update public.approval_requests set status = 'rejected' where id = v_approval_request_id;

    insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_request.group_id, v_uid, 'withdrawal_rejected', 'withdrawal_requests', p_request_id,
      jsonb_build_object('reason', p_notes));

    perform public.create_notification(
      v_request.requested_by, v_request.group_id, 'withdrawal', 'withdrawal_rejected',
      'Your withdrawal request was rejected in ' || coalesce(v_group_name, 'your group'),
      coalesce('Reason: ' || p_notes, 'Your withdrawal request was not approved.'),
      'withdrawal_requests', p_request_id, 'withdrawal_rejected:' || p_request_id
    );

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

  perform public.create_notification(
    v_request.requested_by, v_request.group_id, 'withdrawal', 'withdrawal_approved',
    'Your withdrawal request was approved in ' || coalesce(v_group_name, 'your group'),
    'Your withdrawal request has been approved and is awaiting payment.',
    'withdrawal_requests', p_request_id, 'withdrawal_approved:' || p_request_id
  );

  return query select p_request_id, 'awaiting_payment'::text;
end;
$$;

grant execute on function public.decide_withdrawal_request(uuid, text, text) to authenticated;

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
  v_group_name text;
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

  select name into v_group_name from public.groups where id = v_request.group_id;
  perform public.create_notification(
    v_request.requested_by, v_request.group_id, 'withdrawal', 'withdrawal_paid',
    'Your withdrawal was paid in ' || coalesce(v_group_name, 'your group'),
    'Your withdrawal of ' || p_paid_amount_minor_units || ' has been marked as paid (ref: ' || p_bank_reference || ').',
    'withdrawal_requests', p_request_id, 'withdrawal_paid:' || p_request_id
  );
end;
$$;

grant execute on function public.confirm_withdrawal_payment(uuid, bigint, text, date, text) to authenticated;

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
  v_requested_by uuid;
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reverse a payment';
  end if;

  select group_id, status, requested_by into v_group_id, v_status, v_requested_by
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

  select name into v_group_name from public.groups where id = v_group_id;
  perform public.create_notification(
    v_requested_by, v_group_id, 'withdrawal', 'withdrawal_reversed',
    'Your withdrawal payment was reversed in ' || coalesce(v_group_name, 'your group'),
    'Your withdrawal payment was reversed: ' || p_reason,
    'withdrawal_requests', p_request_id, 'withdrawal_reversed:' || p_request_id
  );
end;
$$;

grant execute on function public.reverse_withdrawal_payment(uuid, text) to authenticated;

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
  v_group_name text;
  v_member record;
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

  select name into v_group_name from public.groups where id = p_group_id;
  for v_member in
    select user_id from public.group_memberships
    where group_id = p_group_id and status = 'active' and user_id <> v_uid
  loop
    perform public.create_notification(
      v_member.user_id, p_group_id, 'governance', 'governance_proposal_opened',
      'A new proposal is open for voting in ' || coalesce(v_group_name, 'your group'),
      '"' || p_title || '" is now open for voting.',
      'governance_proposals', v_proposal_id, 'governance_proposal_opened:' || v_proposal_id || ':' || v_member.user_id
    );
  end loop;

  return query select v_proposal_id;
end;
$$;

grant execute on function public.create_governance_proposal(
  uuid, text, text, text, timestamptz, timestamptz, numeric, numeric
) to authenticated;

-- =======================================================================
-- Member and role management (0013_phase7_member_management.sql, three
-- of these already replaced once by
-- 0014_fix_member_management_owner_lock_visibility.sql) — each gains one
-- additive notification call to the affected member. 'membership' and
-- 'ownership_transfer' are essential categories (see create_notification
-- above) — these always email regardless of the recipient's preference.
-- Every other line is unchanged from the current live function,
-- including 0014's fix (no `for update` on these three lookups).
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
  v_group_name text;
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
  where group_id = p_group_id and user_id = p_member_id;

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

  select name into v_group_name from public.groups where id = p_group_id;
  perform public.create_notification(
    p_member_id, p_group_id, 'membership', 'member_role_changed',
    'Your role changed in ' || coalesce(v_group_name, 'your group'),
    'Your role in ' || coalesce(v_group_name, 'your group') || ' was changed to ' || p_new_role || '. Reason: ' || p_reason,
    'group_memberships', p_member_id, 'member_role_changed:' || p_group_id || ':' || p_member_id || ':' || timezone('utc', now())::text
  );
end;
$$;

grant execute on function public.change_member_role(uuid, uuid, text, text) to authenticated;

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
  v_group_name text;
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
  where group_id = p_group_id and user_id = p_member_id;

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

  select name into v_group_name from public.groups where id = p_group_id;
  perform public.create_notification(
    p_member_id, p_group_id, 'membership', 'member_suspended',
    'You were suspended from ' || coalesce(v_group_name, 'your group'),
    'You have been suspended from ' || coalesce(v_group_name, 'your group') || '. Reason: ' || p_reason,
    'group_memberships', p_member_id, 'member_suspended:' || p_group_id || ':' || p_member_id || ':' || timezone('utc', now())::text
  );
end;
$$;

grant execute on function public.suspend_member(uuid, uuid, text) to authenticated;

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
  v_group_name text;
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

  select name into v_group_name from public.groups where id = p_group_id;
  perform public.create_notification(
    p_member_id, p_group_id, 'membership', 'member_reactivated',
    'You were reactivated in ' || coalesce(v_group_name, 'your group'),
    'Your membership in ' || coalesce(v_group_name, 'your group') || ' has been reactivated.',
    'group_memberships', p_member_id, 'member_reactivated:' || p_group_id || ':' || p_member_id || ':' || timezone('utc', now())::text
  );
end;
$$;

grant execute on function public.reactivate_member(uuid, uuid, text) to authenticated;

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
  v_group_name text;
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
  where group_id = p_group_id and user_id = p_member_id;

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

  select name into v_group_name from public.groups where id = p_group_id;
  perform public.create_notification(
    p_member_id, p_group_id, 'membership', 'member_removed',
    'You were removed from ' || coalesce(v_group_name, 'your group'),
    'You have been removed from ' || coalesce(v_group_name, 'your group') || '. Reason: ' || p_reason,
    'group_memberships', p_member_id, 'member_removed:' || p_group_id || ':' || p_member_id || ':' || timezone('utc', now())::text
  );
end;
$$;

grant execute on function public.remove_member(uuid, uuid, text) to authenticated;

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
  v_group_name text;
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

  select name into v_group_name from public.groups where id = p_group_id;
  perform public.create_notification(
    p_to_user_id, p_group_id, 'ownership_transfer', 'ownership_transfer_initiated',
    'You have been offered ownership of ' || coalesce(v_group_name, 'a group'),
    'The current owner wants to transfer ownership of ' || coalesce(v_group_name, 'this group')
      || ' to you. Reason: ' || p_reason,
    'ownership_transfers', v_transfer_id, 'ownership_transfer_initiated:' || v_transfer_id
  );

  return query select v_transfer_id;
exception
  when unique_violation then
    raise exception 'This group already has a pending ownership transfer';
end;
$$;

grant execute on function public.initiate_ownership_transfer(uuid, uuid, text) to authenticated;

create or replace function public.accept_ownership_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_transfer public.ownership_transfers%rowtype;
  v_group_name text;
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

  select name into v_group_name from public.groups where id = v_transfer.group_id;
  perform public.create_notification(
    v_transfer.from_user_id, v_transfer.group_id, 'ownership_transfer', 'ownership_transfer_accepted',
    'Your ownership transfer was accepted in ' || coalesce(v_group_name, 'your group'),
    'Ownership of ' || coalesce(v_group_name, 'your group')
      || ' has been transferred. You are now an administrator.',
    'ownership_transfers', p_transfer_id, 'ownership_transfer_accepted:' || p_transfer_id
  );
end;
$$;

grant execute on function public.accept_ownership_transfer(uuid) to authenticated;

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
  v_from_user_id uuid;
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select group_id, status, to_user_id, from_user_id into v_group_id, v_status, v_to_user_id, v_from_user_id
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

  select name into v_group_name from public.groups where id = v_group_id;
  perform public.create_notification(
    v_from_user_id, v_group_id, 'ownership_transfer', 'ownership_transfer_declined',
    'Your ownership transfer was declined in ' || coalesce(v_group_name, 'your group'),
    coalesce('Reason: ' || p_reason, 'The recipient declined the ownership transfer.'),
    'ownership_transfers', p_transfer_id, 'ownership_transfer_declined:' || p_transfer_id
  );
end;
$$;

grant execute on function public.decline_ownership_transfer(uuid, text) to authenticated;

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
  v_to_user_id uuid;
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  select group_id, status, to_user_id into v_group_id, v_status, v_to_user_id
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

  select name into v_group_name from public.groups where id = v_group_id;
  perform public.create_notification(
    v_to_user_id, v_group_id, 'ownership_transfer', 'ownership_transfer_cancelled',
    'An ownership transfer offer was cancelled in ' || coalesce(v_group_name, 'your group'),
    'The offer to transfer ownership of ' || coalesce(v_group_name, 'this group') || ' to you was cancelled. Reason: ' || p_reason,
    'ownership_transfers', p_transfer_id, 'ownership_transfer_cancelled:' || p_transfer_id
  );
end;
$$;

grant execute on function public.cancel_ownership_transfer(uuid, text) to authenticated;
