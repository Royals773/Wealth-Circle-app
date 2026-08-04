-- Phase 9 fix: the dedicated scheduler account (SCHEDULER_SUPABASE_EMAIL,
-- src/app/api/scheduler/run/route.ts) can create in-app reminder
-- notifications via the five 0015 SECURITY DEFINER functions, but could
-- never flush their emails: claim_pending_notification_emails() only
-- claims a notification if its recipient shares a group with the
-- caller, a rule written for the normal opportunistic flush path (an
-- ordinary signed-in group member triggering it from their own
-- dashboard). The scheduler account is deliberately memberless (a
-- security choice — it should carry no group access of its own), so it
-- could never satisfy that condition for any group-scoped notification,
-- which is nearly everything the reminder functions produce. Confirmed
-- via a real overdue-contribution dedupe test on staging: both runs
-- returned emailsSent: 0 — not a send failure, claim_pending_notification_emails
-- found nothing to claim. See docs/phase-9-smoke-test.md.
--
-- Fix: a new, narrowly-scoped capability table plus a boolean-returning
-- helper function, following this project's existing pattern for every
-- other privilege check (is_group_member(), is_group_manager(), etc.
-- in 0001_init.sql) — a SECURITY DEFINER function reading a dedicated
-- table keyed by auth.uid(), not a role, not an email-address
-- comparison, not user_metadata (client-editable) or app_metadata (a
-- JWT-claim approach considered and rejected here: it would need the
-- app runtime to hold no elevated credential either, satisfying that
-- requirement, but a revoked app_metadata claim only takes effect on
-- next token refresh — a real revocation-lag window an already-issued
-- session could exploit. A live table read on every call has no such
-- lag: flipping is_active to false blocks the very next call.
--
-- Deliberately does NOT touch group_memberships, does NOT add the
-- scheduler to any group, and does NOT relax notifications' own RLS
-- (still strictly recipient_id = auth.uid() — see 0001_init.sql). The
-- scheduler's only broadened reach is the two functions below, and only
-- for the same narrow fields they already returned/accepted.
--
-- This migration creates the table and functions only. It deliberately
-- does not insert any row — which specific auth.users id is "the
-- scheduler" is environment-specific (a different account per Supabase
-- project), so granting the capability is a one-off, out-of-band admin
-- action per environment (mirroring how the scheduler account itself
-- was originally created), not something a reusable migration should
-- hard-code.

-- =======================================================================
-- scheduler_capabilities
-- RLS enabled, zero policies defined — same pattern as
-- rate_limit_buckets in 0017: no direct client access at all, not even
-- to the scheduler account itself. The only read path is
-- is_active_scheduler() below, and only as a boolean about the caller's
-- own status. Only service-role (out-of-band ops, never the app
-- runtime) can read or write this table directly.
-- =======================================================================
create table if not exists public.scheduler_capabilities (
  user_id uuid primary key references auth.users (id) on delete cascade,
  is_active boolean not null default true,
  label text,
  granted_at timestamptz not null default timezone('utc', now()),
  granted_by uuid references public.profiles (id)
);

comment on table public.scheduler_capabilities is
  'Allowlist of auth.users ids permitted to act as the notification-email scheduler. Populated only via service-role out-of-band per environment — never by the app runtime, never by a migration hard-coding an environment-specific id. Checked only through is_active_scheduler().';

alter table public.scheduler_capabilities enable row level security;

-- =======================================================================
-- is_active_scheduler: true iff the calling user (auth.uid()) currently
-- holds an active scheduler capability grant. Self-referential (like
-- is_group_member()), so safe to grant broadly to authenticated — it
-- only ever answers "am I one", never lets a caller enumerate anyone
-- else's grant.
-- =======================================================================
create or replace function public.is_active_scheduler()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.scheduler_capabilities sc
    where sc.user_id = auth.uid()
      and sc.is_active = true
  );
$$;

revoke all on function public.is_active_scheduler() from public;
grant execute on function public.is_active_scheduler() to authenticated;

-- =======================================================================
-- claim_pending_notification_emails — additive fix over 0015's version:
--   1. Authorization: a caller may now also claim a notification if
--      they hold an active scheduler capability, in addition to the
--      original "shares a group with the recipient" condition (which
--      is unchanged and still governs the ordinary in-app flush path —
--      confirmed unaffected by tests/security/notifications.test.ts's
--      existing "only claims notifications whose recipient shares a
--      group" test, still exercised and still green).
--   2. Retry policy: a row stuck in 'sending' (an abandoned/crashed
--      claim) or 'failed' (a real send error) becomes reclaimable again
--      after a fixed cooldown, so a delivery failure or a crashed
--      flush isn't a permanent dead end. 15 minutes, matching this
--      project's own discussed scheduler cadence (5-30 min) — long
--      enough that a normal in-flight send can't be double-claimed,
--      short enough that a genuine failure gets retried within a
--      couple of scheduler runs. Same signature as before
--      (create or replace, not a new overload), so no caller needs to
--      change how it invokes this function.
-- Still bounded (p_limit), still atomic under concurrency (the same
-- `for update skip locked`), still returns only the fields needed to
-- send — recipient_email/subject/action_path, never the notification
-- body or any financial data.
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
set search_path = ''
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
      where (
        n2.email_status = 'pending'
        or (
          n2.email_status in ('sending', 'failed')
          and n2.email_attempted_at < timezone('utc', now()) - interval '15 minutes'
        )
      )
      and (
        n2.group_id is null
        or public.is_active_scheduler()
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

revoke all on function public.claim_pending_notification_emails(integer) from public;
grant execute on function public.claim_pending_notification_emails(integer) to authenticated;

-- =======================================================================
-- mark_notification_email_result — additive fix: a related, adjacent
-- gap found while closing the one above. The 0015 version only checked
-- that the caller was authenticated and that the target row was
-- actually 'sending' — it never verified the caller was ever entitled
-- to that notification in the first place, so any authenticated user
-- could call this for any in-flight notification_id and mark it
-- 'sent'/'failed' with an arbitrary error, silently suppressing someone
-- else's real pending email. Now scoped with the exact same condition
-- as the claim above (group-sharing or active scheduler), so it's only
-- ever usable to report on a delivery the caller could legitimately
-- have claimed. Same signature as before.
-- =======================================================================
create or replace function public.mark_notification_email_result(
  p_notification_id uuid,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_status not in ('sent', 'failed') then
    raise exception 'Invalid status';
  end if;

  update public.notifications n
  set email_status = p_status, email_attempted_at = timezone('utc', now()), email_error = p_error
  where n.id = p_notification_id
    and n.email_status = 'sending'
    and (
      n.group_id is null
      or public.is_active_scheduler()
      or exists (
        select 1
        from public.group_memberships caller_gm
        join public.group_memberships recipient_gm
          on recipient_gm.group_id = caller_gm.group_id
        where caller_gm.user_id = v_uid
          and recipient_gm.user_id = n.recipient_id
      )
    );
end;
$$;

revoke all on function public.mark_notification_email_result(uuid, text, text) from public;
grant execute on function public.mark_notification_email_result(uuid, text, text) to authenticated;
