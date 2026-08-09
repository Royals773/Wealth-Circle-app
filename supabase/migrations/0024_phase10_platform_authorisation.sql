-- Phase 10: platform-level group/organiser authorisation.
--
-- Closes the gap found in the read-only audit that opened this phase:
-- any authenticated user could create a group and become its owner
-- immediately, and any owner/administrator could send invitations,
-- with no platform-level approval step and no way to suspend a group
-- or an organiser. It also closes a second, independently found issue:
-- groups_update_managers (0001_init.sql) let any owner/administrator
-- PATCH any column on `groups` directly via the client, including
-- `status` — confirmed exploitable and, on inspection, completely
-- unused by the app (every `.from("groups")` call in src/ is a
-- .select(), never an .update()).
--
-- Design is documented in full in the "Revised Platform-Authorisation
-- Plan v3" review (state-transition tables, function inventory,
-- concurrency strategy, audit guarantees/limitations) — this migration
-- implements that plan plus five follow-up decisions:
--   1. Keep `archived` (no `closed` rename) — see archive_group() below,
--      a new self-service owner/administrator action.
--   2. reactivate_member() is gated like any other membership mutation;
--      leave_group() stays exempt.
--   3. Group rejection is terminal in this phase — no reopen/resubmit RPC.
--   4. organiser_applications enforces "at most one current row per
--      user across pending/approved/suspended" at the database level
--      (organiser_applications_one_current_per_user below); reactivation
--      after suspension UPDATEs that row back to approved, never inserts
--      a new one; the grandfathering backfill is NOT EXISTS-guarded so
--      it is safe to re-run.
--   5. expire_stale_invitations()/expire_stale_ownership_transfers()
--      stay exempt from the active-group gate — they only remove stale
--      authority, never grant new authority.
--
-- Every new SECURITY DEFINER function: search_path = '' with every
-- object fully qualified (the convention established from
-- 0002_phase2_auth_functions.sql onward, stricter than the four
-- earliest 0001_init.sql helpers), and `revoke all ... from public`
-- paired with a narrow `grant execute ... to authenticated` (the
-- convention established in 0018/0020/0021/0023).

-- =======================================================================
-- Preflight (point 11 of the review): report existing data before any
-- backfill runs. Informational only — does not abort the migration.
-- Real staging numbers gathered during the audit: 2 groups, both
-- 'active' with exactly one active owner, 0 anomalies, 0 pending
-- invitations. This block exists so the same is verified independently
-- wherever this migration is actually applied, not assumed from staging.
-- =======================================================================
do $$
declare
  v_ownerless int;
  v_multi_owner int;
  v_dup_pending_invites int;
  v_by_status text;
begin
  select string_agg(status || '=' || cnt, ', ') into v_by_status
  from (select status, count(*) cnt from public.groups group by status) s;

  select count(*) into v_ownerless
    from public.groups g
    where not exists (
      select 1 from public.group_memberships gm
      where gm.group_id = g.id and gm.role = 'owner' and gm.status = 'active'
    );

  select count(*) into v_multi_owner
    from (
      select group_id from public.group_memberships
      where role = 'owner' and status = 'active'
      group by group_id having count(*) > 1
    ) x;

  select count(*) into v_dup_pending_invites
    from (
      select group_id, lower(trim(email))
      from public.group_invitations
      where status = 'pending'
      group by 1, 2 having count(*) > 1
    ) y;

  raise notice 'Phase 10 preflight — groups by status: %; ownerless groups: %; multi-owner groups: %; groups with duplicate-pending-email invitations: %',
    coalesce(v_by_status, '(none)'), v_ownerless, v_multi_owner, v_dup_pending_invites;
end $$;

-- =======================================================================
-- groups.status: extend the lifecycle. archive_group() below is the
-- only path to 'archived' — a deliberate, self-service, owner-only
-- action, terminal once reached. pending_review/rejected are new;
-- suspended already existed but was unenforced.
-- =======================================================================
alter table public.groups
  drop constraint if exists groups_status_check;
alter table public.groups
  add constraint groups_status_check
  check (status in ('pending_review', 'active', 'rejected', 'suspended', 'archived'));

-- groups_update_managers let any owner/administrator PATCH any column
-- on groups directly, including status — confirmed unused by the app
-- (grep of every `.from("groups")` call in src/: all reads, zero
-- writes). Dropped rather than narrowed: RLS cannot restrict individual
-- columns, and there is no legitimate direct-update use case to
-- preserve. All status transitions now go exclusively through the
-- SECURITY DEFINER RPCs below, each of which row-locks its target —
-- which only works cleanly because there is no RLS UPDATE policy left
-- on groups to conflict with the lock (see 0014's documented
-- for-update-vs-RLS-UPDATE-policy interaction).
drop policy if exists "groups_update_managers" on public.groups;

-- groups_select_platform_admins is created further below, after
-- is_platform_admin() exists — CREATE POLICY resolves the functions in
-- its USING clause at creation time, so it can't reference a function
-- that doesn't exist yet.

-- =======================================================================
-- organiser_applications
-- =======================================================================
create table if not exists public.organiser_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  application_note text,
  submitted_at timestamptz not null default timezone('utc', now()),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.organiser_applications is
  'One row per organiser application/decision. At most one row per user may hold status in (pending, approved, suspended) — see organiser_applications_one_current_per_user. A rejected row is terminal but excluded from that constraint, so a fresh application after rejection is a new row. Reactivation after suspension updates the existing row back to approved rather than inserting a new one. No client write policy exists at all — the only writes are apply_for_organiser_status() (insert) and the platform-admin decision RPCs (update). Status history lives in audit_logs, not in duplicate rows.';

alter table public.organiser_applications enable row level security;

drop index if exists public.organiser_applications_one_pending_per_user;
create unique index if not exists organiser_applications_one_current_per_user
  on public.organiser_applications (user_id)
  where status in ('pending', 'approved', 'suspended');

create index if not exists organiser_applications_user_submitted_idx
  on public.organiser_applications (user_id, submitted_at desc);

drop policy if exists "organiser_applications_select_self" on public.organiser_applications;
create policy "organiser_applications_select_self" on public.organiser_applications
  for select using (user_id = auth.uid());
-- Deliberately no insert/update/delete policy — see comment above.
-- organiser_applications_select_platform_admins is created further
-- below, after is_platform_admin() exists (same reason as
-- groups_select_platform_admins above).

-- =======================================================================
-- platform_admins — same shape and bootstrap discipline as
-- scheduler_capabilities (0018_phase9_scheduler_email_capability.sql):
-- RLS enabled, zero policies, populated only via a documented,
-- out-of-band service-role insert per environment. No UUID is ever
-- hard-coded in a migration.
-- =======================================================================
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default timezone('utc', now()),
  notes text
);

comment on table public.platform_admins is
  'Allowlist of auth.users ids permitted to act as platform administrators. Populated only via service-role out-of-band per environment — never by the app runtime, never by a migration hard-coding an environment-specific id. Checked only through is_platform_admin(). See docs/platform-admin-bootstrap.md.';

alter table public.platform_admins enable row level security;
-- Zero policies, deliberately: no client role can select, insert,
-- update, or delete this table under any circumstance.

-- =======================================================================
-- platform_config — bounded, validated, audited, platform-admin-only
-- writes via set_platform_config_int(). No client write policy.
-- =======================================================================
create table if not exists public.platform_config (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.platform_config enable row level security;
-- Zero client policies. Read-through only via get_platform_config_int();
-- write-through only via set_platform_config_int().

insert into public.platform_config (key, value)
values ('max_pending_invitations_per_group', '20'::jsonb)
on conflict (key) do nothing;

-- =======================================================================
-- Helper functions
-- =======================================================================
create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

-- Granted to anon as well as authenticated: this function is
-- referenced inside groups_select_platform_admins/
-- organiser_applications_select_platform_admins/
-- audit_logs_select_platform_admins RLS policies (below). RLS
-- evaluates every applicable USING clause for the querying role,
-- including anon — if anon can't execute a function a policy
-- references, evaluating that policy raises a permission error and
-- aborts the whole query (not just contributes "false" to the OR),
-- even for tables anon should be able to query and get an empty
-- result from. Safe either way: for anon, auth.uid() is null, so this
-- always evaluates to false — no information leak.
revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to anon, authenticated;

create or replace function public.is_group_active(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (select 1 from public.groups where id = p_group_id and status = 'active');
$$;

revoke all on function public.is_group_active(uuid) from public, anon;
grant execute on function public.is_group_active(uuid) to authenticated;

create or replace function public.is_organiser_approved(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.organiser_applications
    where user_id = p_user_id and status = 'approved'
  );
$$;

revoke all on function public.is_organiser_approved(uuid) from public, anon;
grant execute on function public.is_organiser_approved(uuid) to authenticated;

create or replace function public.get_platform_config_int(p_key text, p_default integer)
returns integer
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::integer from public.platform_config where key = p_key), p_default);
$$;

revoke all on function public.get_platform_config_int(text, integer) from public, anon;
grant execute on function public.get_platform_config_int(text, integer) to authenticated;

create or replace function public.set_platform_config_int(p_key text, p_value integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_value jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform administrator may change platform configuration';
  end if;
  if p_key not in ('max_pending_invitations_per_group') then
    raise exception 'Unknown configuration key: %', p_key;
  end if;
  if p_value is null or p_value < 1 or p_value > 1000 then
    raise exception 'Value must be a positive integer no greater than 1000';
  end if;

  select value into v_old_value from public.platform_config where key = p_key;

  insert into public.platform_config (key, value, updated_by, updated_at)
  values (p_key, to_jsonb(p_value), auth.uid(), timezone('utc', now()))
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'platform_config_changed', 'platform_config', null,
          jsonb_build_object('key', p_key, 'previous_value', v_old_value, 'new_value', to_jsonb(p_value), 'reason', p_reason));
end;
$$;

revoke all on function public.set_platform_config_int(text, integer, text) from public, anon;
grant execute on function public.set_platform_config_int(text, integer, text) to authenticated;

-- =======================================================================
-- Deferred from earlier: these two SELECT policies reference
-- is_platform_admin(), which now exists. A platform administrator
-- needs to see every group and every organiser application (not just
-- their own/created ones) to run the review queue.
-- groups_select_members/organiser_applications_select_self are
-- unchanged — these only add a second, independent read path for
-- platform admins, never removing tenant isolation for anyone else.
-- =======================================================================
drop policy if exists "groups_select_platform_admins" on public.groups;
create policy "groups_select_platform_admins" on public.groups
  for select using (public.is_platform_admin());

drop policy if exists "organiser_applications_select_platform_admins" on public.organiser_applications;
create policy "organiser_applications_select_platform_admins" on public.organiser_applications
  for select using (public.is_platform_admin());

-- =======================================================================
-- Organiser application workflow
-- =======================================================================
create or replace function public.apply_for_organiser_status(p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_current public.organiser_applications%rowtype;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_current
    from public.organiser_applications
    where user_id = v_uid and status in ('pending', 'approved', 'suspended')
    for update;

  if v_current.status = 'approved' then
    raise exception 'You already have organiser access.';
  elsif v_current.status = 'suspended' then
    raise exception 'Your organiser access is currently suspended. Contact a platform administrator.';
  elsif v_current.status = 'pending' then
    raise exception 'You already have a pending organiser application.';
  end if;

  begin
    insert into public.organiser_applications (user_id, application_note)
    values (v_uid, p_note)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You already have a pending organiser application.';
  end;

  return v_id;
end;
$$;

revoke all on function public.apply_for_organiser_status(text) from public, anon;
grant execute on function public.apply_for_organiser_status(text) to authenticated;

create or replace function public.decide_organiser_application(
  p_user_id uuid,
  p_decision text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_app public.organiser_applications%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Only a platform administrator can decide on organiser applications';
  end if;
  if p_user_id = v_uid then
    raise exception 'You cannot decide on your own organiser application';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into v_app
    from public.organiser_applications
    where user_id = p_user_id and status = 'pending'
    for update;

  if v_app.id is null then
    raise exception 'No pending organiser application found for this user';
  end if;

  update public.organiser_applications
  set status = p_decision, decided_by = v_uid, decided_at = timezone('utc', now()), decision_reason = p_reason
  where id = v_app.id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    null, v_uid,
    case when p_decision = 'approved' then 'organiser_approved' else 'organiser_rejected' end,
    'organiser_applications', v_app.id,
    jsonb_build_object('target_user_id', p_user_id, 'previous_status', 'pending', 'new_status', p_decision, 'reason', p_reason)
  );
end;
$$;

revoke all on function public.decide_organiser_application(uuid, text, text) from public, anon;
grant execute on function public.decide_organiser_application(uuid, text, text) to authenticated;

create or replace function public.suspend_organiser(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_app public.organiser_applications%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Only a platform administrator can suspend an organiser';
  end if;
  if p_user_id = v_uid then
    raise exception 'You cannot suspend yourself';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  select * into v_app
    from public.organiser_applications
    where user_id = p_user_id and status = 'approved'
    for update;

  if v_app.id is null then
    raise exception 'No active organiser status found for this user';
  end if;

  update public.organiser_applications
  set status = 'suspended', decided_by = v_uid, decided_at = timezone('utc', now()), decision_reason = p_reason
  where id = v_app.id;

  -- Deliberately does not touch groups owned by this organiser — see
  -- decision 9 of the original correction: suspension blocks new group
  -- creation only, existing groups need explicit per-group decisions.
  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    null, v_uid, 'organiser_suspended', 'organiser_applications', v_app.id,
    jsonb_build_object('target_user_id', p_user_id, 'previous_status', 'approved', 'new_status', 'suspended', 'reason', p_reason)
  );
end;
$$;

revoke all on function public.suspend_organiser(uuid, text) from public, anon;
grant execute on function public.suspend_organiser(uuid, text) to authenticated;

create or replace function public.reactivate_organiser(p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_app public.organiser_applications%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Only a platform administrator can reactivate an organiser';
  end if;
  if p_user_id = v_uid then
    raise exception 'You cannot reactivate your own organiser status';
  end if;

  select * into v_app
    from public.organiser_applications
    where user_id = p_user_id and status = 'suspended'
    for update;

  if v_app.id is null then
    raise exception 'No suspended organiser record found for this user';
  end if;

  -- Updates the existing row back to approved — never inserts a new
  -- one (decision 4).
  update public.organiser_applications
  set status = 'approved', decided_by = v_uid, decided_at = timezone('utc', now()), decision_reason = p_reason
  where id = v_app.id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    null, v_uid, 'organiser_reactivated', 'organiser_applications', v_app.id,
    jsonb_build_object('target_user_id', p_user_id, 'previous_status', 'suspended', 'new_status', 'approved', 'reason', p_reason)
  );
end;
$$;

revoke all on function public.reactivate_organiser(uuid, text) from public, anon;
grant execute on function public.reactivate_organiser(uuid, text) to authenticated;

-- =======================================================================
-- Group moderation workflow
-- =======================================================================
create or replace function public.decide_group_review(p_group_id uuid, p_decision text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group public.groups%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Only a platform administrator can review a group';
  end if;
  if p_decision not in ('active', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into v_group from public.groups where id = p_group_id for update;
  if v_group.id is null then
    raise exception 'Group not found';
  end if;
  if v_group.status <> 'pending_review' then
    raise exception 'This group is not awaiting review';
  end if;

  if exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and user_id = v_uid and role = 'owner' and status = 'active'
  ) then
    raise exception 'You cannot review a group you own';
  end if;

  update public.groups set status = p_decision where id = p_group_id;

  -- Rejection is terminal in this phase — no reopen/resubmission RPC
  -- exists (decision 3). The reason is preserved permanently here in
  -- audit_logs, never overwritten.
  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_group_id, v_uid,
    case when p_decision = 'active' then 'group_approved' else 'group_rejected' end,
    'groups', p_group_id,
    jsonb_build_object('previous_status', 'pending_review', 'new_status', p_decision, 'reason', p_reason)
  );
end;
$$;

revoke all on function public.decide_group_review(uuid, text, text) from public, anon;
grant execute on function public.decide_group_review(uuid, text, text) to authenticated;

create or replace function public.suspend_group(p_group_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group public.groups%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Only a platform administrator can suspend a group';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  select * into v_group from public.groups where id = p_group_id for update;
  if v_group.id is null then
    raise exception 'Group not found';
  end if;
  if v_group.status <> 'active' then
    raise exception 'Only an active group can be suspended';
  end if;
  if exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and user_id = v_uid and role = 'owner' and status = 'active'
  ) then
    raise exception 'You cannot suspend a group you own';
  end if;

  update public.groups set status = 'suspended' where id = p_group_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'group_suspended', 'groups', p_group_id,
    jsonb_build_object('previous_status', 'active', 'new_status', 'suspended', 'reason', p_reason));
end;
$$;

revoke all on function public.suspend_group(uuid, text) from public, anon;
grant execute on function public.suspend_group(uuid, text) to authenticated;

create or replace function public.reactivate_group(p_group_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group public.groups%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Only a platform administrator can reactivate a group';
  end if;

  select * into v_group from public.groups where id = p_group_id for update;
  if v_group.id is null then
    raise exception 'Group not found';
  end if;
  if v_group.status <> 'suspended' then
    raise exception 'Only a suspended group can be reactivated';
  end if;
  if exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and user_id = v_uid and role = 'owner' and status = 'active'
  ) then
    raise exception 'You cannot reactivate a group you own';
  end if;

  update public.groups set status = 'active' where id = p_group_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'group_reactivated', 'groups', p_group_id,
    jsonb_build_object('previous_status', 'suspended', 'new_status', 'active', 'reason', p_reason));
end;
$$;

revoke all on function public.reactivate_group(uuid, text) from public, anon;
grant execute on function public.reactivate_group(uuid, text) to authenticated;

-- Self-service, owner/administrator-only, matching decision 1: `archived`
-- is kept (not renamed to `closed`) and documented as the
-- owner-controlled inactive state — distinct from suspend/reactivate,
-- which are platform-admin actions. Terminal: no RPC transitions a
-- group out of 'archived'.
create or replace function public.archive_group(p_group_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group public.groups%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_group_manager(p_group_id) then
    raise exception 'Only an owner or administrator can archive this group';
  end if;

  select * into v_group from public.groups where id = p_group_id for update;
  if v_group.id is null then
    raise exception 'Group not found';
  end if;
  if v_group.status <> 'active' then
    raise exception 'Only an active group can be archived';
  end if;

  update public.groups set status = 'archived' where id = p_group_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'group_archived', 'groups', p_group_id,
    jsonb_build_object('previous_status', 'active', 'new_status', 'archived', 'reason', p_reason));
end;
$$;

revoke all on function public.archive_group(uuid, text) from public, anon;
grant execute on function public.archive_group(uuid, text) to authenticated;

-- =======================================================================
-- audit_logs: platform-level entries (group_id is null) are already
-- insertable (audit_logs_insert_members, 0001_init.sql) but not
-- selectable by anyone (audit_logs_select_managers_and_auditors
-- requires group_id is not null). Additive policy — nothing existing
-- changes.
-- =======================================================================
drop policy if exists "audit_logs_select_platform_admins" on public.audit_logs;
create policy "audit_logs_select_platform_admins" on public.audit_logs
  for select using (group_id is null and public.is_platform_admin());

-- =======================================================================
-- create_group_with_setup: gate on organiser approval, new groups start
-- pending_review. Deliberately drops the initial-invite-sending loop:
-- create_invitation() now requires an active group (below), and a
-- brand-new pending_review group must not be able to send invitations
-- — exactly the behaviour point 3/5 of the review requires. Group
-- creators invite members from the dashboard once a platform
-- administrator approves the group. p_invites/invite_links stay in the
-- signature for compatibility; p_invites is now accepted but ignored.
-- =======================================================================
create or replace function public.create_group_with_setup(
  p_name text,
  p_slug text,
  p_description text,
  p_country_code text,
  p_currency_code text,
  p_contribution_frequency text,
  p_contribution_type text,
  p_fixed_amount_minor_units bigint,
  p_financial_year_start_month smallint,
  p_rules text,
  p_invites jsonb
)
returns table (group_id uuid, slug text, invite_links jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_organiser_approved(v_uid) then
    raise exception 'You need an approved organiser application before you can create a group';
  end if;

  begin
    insert into public.groups (
      name, slug, description, country_code, currency_code,
      contribution_frequency, contribution_type,
      financial_year_start_month, rules, status, created_by
    ) values (
      p_name, p_slug, p_description, p_country_code, p_currency_code,
      p_contribution_frequency, p_contribution_type,
      p_financial_year_start_month, p_rules, 'pending_review', v_uid
    )
    returning id into v_group_id;
  exception
    when unique_violation then
      raise exception 'That group URL is already taken. Please choose a different one.';
  end;

  -- The groups_after_insert_create_owner_membership trigger has already
  -- fired synchronously at this point, so v_uid is now this group's
  -- owner and passes is_group_manager() for the insert below.

  if p_contribution_type = 'fixed' and p_fixed_amount_minor_units is not null then
    insert into public.contribution_plans (
      group_id, name, amount_minor_units, currency_code,
      frequency, is_flexible, start_date, created_by
    ) values (
      v_group_id, 'Standard contribution', p_fixed_amount_minor_units, p_currency_code,
      p_contribution_frequency, false, current_date, v_uid
    );
  end if;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_group_id, v_uid, 'group_created', 'groups', v_group_id,
    jsonb_build_object('name', p_name, 'slug', p_slug, 'status', 'pending_review')
  );

  return query select v_group_id, p_slug, '[]'::jsonb;
end;
$$;

grant execute on function public.create_group_with_setup(
  text, text, text, text, text, text, text, bigint, smallint, text, jsonb
) to authenticated;

-- =======================================================================
-- Invitations: create_invitation gains active-group gating, database
-- rate-limit/cap/duplicate enforcement (point 10), and safe concurrency
-- (point 4/the "invitation concurrency" review point) — an advisory
-- lock scoped to the group (not a `for update` on groups, which would
-- satisfy no RLS UPDATE policy now that groups_update_managers is
-- dropped), plus a partial unique index as the hard duplicate-email
-- guarantee. accept_invitation/get_invitation_preview become
-- group-status-aware without ever exposing the raw status string.
-- =======================================================================
drop index if exists public.group_invitations_one_pending_per_email;
create unique index if not exists group_invitations_one_pending_per_email
  on public.group_invitations (group_id, lower(trim(email)))
  where status = 'pending';

create or replace function public.create_invitation(
  p_group_id uuid,
  p_email text,
  p_role text
)
returns table (invitation_id uuid, raw_token text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_raw_token text;
  v_token_hash text;
  v_invitation_id uuid;
  v_normalized_email text;
  v_max_pending integer;
  v_pending_count integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_group_manager(p_group_id) then
    raise exception 'Only group owners and administrators can create invitations';
  end if;

  if not public.is_group_active(p_group_id) then
    raise exception 'This group is not currently active';
  end if;

  -- 'owner' is deliberately excluded: ownership is only granted via group
  -- creation or an explicit owner-to-owner promotion (see the
  -- group_memberships_update_managers policy), never via invitation.
  if p_role not in ('administrator', 'treasurer', 'loan_officer', 'auditor', 'member') then
    raise exception 'That role cannot be used for an invitation';
  end if;

  v_normalized_email := lower(trim(p_email));

  if not public.check_rate_limit('invite:' || v_uid::text || ':' || p_group_id::text, 3600, 20) then
    raise exception 'You are creating invitations too quickly. Please wait before trying again.';
  end if;

  -- Serializes all concurrent invitation attempts for this one group,
  -- so the expire-then-count-then-insert sequence below is atomic under
  -- concurrency. Not a `for update` on the group row: security invoker,
  -- and groups has no UPDATE policy left (groups_update_managers was
  -- dropped above) to satisfy that lock under RLS.
  perform pg_advisory_xact_lock(hashtext('invite_cap:' || p_group_id::text));

  update public.group_invitations
  set status = 'expired'
  where group_id = p_group_id and status = 'pending' and expires_at <= timezone('utc', now());

  select public.get_platform_config_int('max_pending_invitations_per_group', 20) into v_max_pending;

  select count(*) into v_pending_count
  from public.group_invitations
  where group_id = p_group_id and status = 'pending';

  if v_pending_count >= v_max_pending then
    raise exception 'This group has reached its limit of % pending invitations', v_max_pending;
  end if;

  if exists (
    select 1 from public.group_invitations
    where group_id = p_group_id and status = 'pending' and lower(trim(email)) = v_normalized_email
  ) then
    raise exception 'There is already a pending invitation for that email address';
  end if;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');

  begin
    insert into public.group_invitations (
      group_id, email, role, token_hash, invited_by, expires_at
    ) values (
      p_group_id, v_normalized_email, p_role, v_token_hash, v_uid,
      timezone('utc', now()) + interval '7 days'
    )
    returning id into v_invitation_id;
  exception when unique_violation then
    raise exception 'There is already a pending invitation for that email address';
  end;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_group_id, v_uid, 'invitation_created', 'group_invitations', v_invitation_id,
    jsonb_build_object('email', v_normalized_email, 'role', p_role)
  );

  return query select v_invitation_id, v_raw_token;
end;
$$;

grant execute on function public.create_invitation(uuid, text, text) to authenticated;

-- Point 7: no raw group/invitation status is ever returned — only a
-- computed can_accept boolean and a generic message. Never distinguishes
-- suspended/rejected/pending_review/archived, or expired vs revoked.
-- email is kept (the pre-0024 shape always included it) — it is not
-- moderation-sensitive, and the invitation-acceptance page needs it to
-- prefill sign-up and confirm the signed-in user matches the invite.
--
-- CREATE OR REPLACE cannot change a function's RETURNS TABLE row type
-- (columns 4/5 change from status text, expires_at timestamptz to
-- can_accept boolean, message text) — same constraint documented in
-- 0005_fix_onboarding_invite_links_lost.sql — so the old definition
-- must be dropped first.
drop function if exists public.get_invitation_preview(text);

create or replace function public.get_invitation_preview(p_token text)
returns table (
  group_name text,
  role text,
  email text,
  can_accept boolean,
  message text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_token_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_row record;
begin
  select g.name as name, gi.role as role, gi.email as email, gi.status as invitation_status,
         gi.expires_at as expires_at, g.status as group_status
    into v_row
    from public.group_invitations gi
    join public.groups g on g.id = gi.group_id
    where gi.token_hash = v_token_hash
    limit 1;

  if not found then
    return query select null::text, null::text, null::text, false, 'This invitation could not be found.';
    return;
  end if;

  if v_row.invitation_status <> 'pending' or v_row.expires_at <= timezone('utc', now()) then
    return query select v_row.name, v_row.role, v_row.email, false, 'This invitation is no longer available.';
  elsif v_row.group_status <> 'active' then
    return query select v_row.name, v_row.role, v_row.email, false, 'This group is currently unavailable. Please contact the group organiser.';
  else
    return query select v_row.name, v_row.role, v_row.email, true, null::text;
  end if;
end;
$$;

revoke all on function public.get_invitation_preview(text) from public;
grant execute on function public.get_invitation_preview(text) to anon, authenticated;

-- accept_invitation: unchanged behaviour except the new group-status
-- check, inserted after the invitation itself is validated but before
-- anything is written — a suspended/rejected/pending_review/archived
-- group's invitation is neither consumed nor revoked by a failed
-- accept attempt, so it works normally again after reactivation.
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
  v_group_status text;
  v_existing_status text;
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

  select status into v_group_status from public.groups where id = v_invitation.group_id;
  if v_group_status <> 'active' then
    raise exception 'This group is currently unavailable. Please contact the group organiser.';
  end if;

  select email into v_user_email from auth.users where id = v_uid;

  if v_user_email is null or lower(v_user_email) <> lower(v_invitation.email) then
    raise exception 'This invitation was sent to a different email address.';
  end if;

  select gm.status into v_existing_status
  from public.group_memberships gm
  where gm.group_id = v_invitation.group_id and gm.user_id = v_uid
  for update;

  if v_existing_status is not null and v_existing_status <> 'removed' then
    raise exception 'You are already a member of this group.';
  end if;

  if v_existing_status = 'removed' then
    update public.group_memberships
    set status = 'active', role = v_invitation.role, joined_at = timezone('utc', now())
    where group_memberships.group_id = v_invitation.group_id and user_id = v_uid;
  else
    insert into public.group_memberships (group_id, user_id, role, status)
    values (v_invitation.group_id, v_uid, v_invitation.role, 'active');
  end if;

  update public.group_invitations
  set status = 'accepted', accepted_at = timezone('utc', now()), accepted_by = v_uid
  where id = v_invitation.id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_invitation.group_id, v_uid, 'invitation_accepted', 'group_invitations', v_invitation.id,
    jsonb_build_object('role', v_invitation.role, 'rejoined', v_existing_status = 'removed')
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

  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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
-- Memberships and ownership transfers: each gains one is_group_active()
-- check, inserted immediately after the existing authorisation check.
-- leave_group() is deliberately untouched/exempt (a member must always
-- be able to exit). reactivate_member() is gated like every other
-- membership mutation (decision 2) — a suspended group stays read-only.
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
  if not public.is_group_active(p_group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(p_group_id) then
    raise exception 'This group is not currently active';
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
  v_role text;
  v_status text;
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_group_manager(p_group_id) then
    raise exception 'Only owners and administrators can reactivate members';
  end if;
  if not public.is_group_active(p_group_id) then
    raise exception 'This group is not currently active';
  end if;
  if p_member_id = v_uid then
    raise exception 'You cannot reactivate your own membership';
  end if;

  select role, status into v_role, v_status
  from public.group_memberships
  where group_id = p_group_id and user_id = p_member_id
  for update;

  if v_role is null then
    raise exception 'Member not found in this group';
  end if;
  if v_status not in ('suspended', 'removed') then
    raise exception 'Only a suspended or removed member can be reactivated';
  end if;

  update public.group_memberships
  set status = 'active',
      joined_at = case when v_status = 'removed' then timezone('utc', now()) else joined_at end
  where group_id = p_group_id and user_id = p_member_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_group_id, v_uid, 'member_reactivated', 'group_memberships', p_member_id,
    jsonb_build_object('reason', p_reason, 'previous_status', v_status));

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
  if not public.is_group_active(p_group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(p_group_id) then
    raise exception 'This group is not currently active';
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

-- SECURITY DEFINER: bypasses RLS, so the active-group check here is the
-- only thing gating it (point 4's explicit warning about DEFINER
-- functions). Modernised from `set search_path = public` to `= ''`
-- while touching this function anyway — every reference was already
-- fully qualified, so this is a safe hardening, not a behaviour change.
create or replace function public.accept_ownership_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
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
  if not public.is_group_active(v_transfer.group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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

-- =======================================================================
-- Contributions: each gains one is_group_active() check after its
-- existing role check.
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

  if not public.is_group_active(p_group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(p_group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(p_group_id) then
    raise exception 'This group is not currently active';
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

  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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

  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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

  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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

  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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

  if not public.is_group_active(v_original.group_id) then
    raise exception 'This group is not currently active';
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
-- Loans: each gains one is_group_active() check. Also still gated
-- independently by 0021's legal-review revoke — both gates apply.
-- cancel_loan_application is self-service (the applicant, not a
-- manager) but is still a business mutation, so it is gated too.
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

  if not public.is_group_active(p_group_id) then
    raise exception 'This group is not currently active';
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
-- 0021_gate_lending_pending_legal_review.sql revoked EXECUTE on this
-- function pending UK legal/regulatory review — re-applying that
-- revoke immediately, since CREATE OR REPLACE + the grant above would
-- otherwise silently re-enable it. See that migration's own comment
-- for the 2026-08-06 incident this closed.
revoke execute on function public.apply_for_loan(uuid, bigint, integer, text) from public, anon, authenticated;

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

  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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
revoke execute on function public.mark_loan_under_review(uuid) from public, anon, authenticated;

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

  if not public.is_group_active(v_application.group_id) then
    raise exception 'This group is not currently active';
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
revoke execute on function public.decide_loan_application(uuid, text, bigint, integer, integer, text, text) from public, anon, authenticated;

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

  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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
revoke execute on function public.cancel_loan_application(uuid) from public, anon, authenticated;

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

  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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
revoke execute on function public.record_disbursement(uuid, date, text, text) from public, anon, authenticated;

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

  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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
revoke execute on function public.mark_loan_defaulted(uuid, text) from public, anon, authenticated;

-- =======================================================================
-- Repayments: each gains one is_group_active() check.
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

  if not public.is_group_active(v_loan.group_id) then
    raise exception 'This group is not currently active';
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
revoke execute on function public.record_repayment(uuid, bigint, date, text, text, text) from public, anon, authenticated;

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

  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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
revoke execute on function public.verify_repayment(uuid) from public, anon, authenticated;

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

  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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
revoke execute on function public.reconcile_repayment(uuid) from public, anon, authenticated;

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

  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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
revoke execute on function public.reject_repayment(uuid, text) from public, anon, authenticated;

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

  if not public.is_group_active(v_original.group_id) then
    raise exception 'This group is not currently active';
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
revoke execute on function public.reverse_repayment(uuid, text, jsonb) from public, anon, authenticated;

-- =======================================================================
-- Withdrawals: each gains one is_group_active() check.
-- cancel_withdrawal_request is self-service (the requester) but is
-- still a business mutation, so it is gated too.
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

  if not public.is_group_active(p_group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(v_request.group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(v_request.group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(v_group_id) then
    raise exception 'This group is not currently active';
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

-- =======================================================================
-- Governance and votes: each gains one is_group_active() check.
-- cast_vote's gate is explicitly required (point 6 of the review).
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
  v_group_name text;
  v_member record;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'You are not a member of this group';
  end if;
  if not public.is_group_active(p_group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(v_proposal.group_id) then
    raise exception 'This group is not currently active';
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
  if not public.is_group_active(v_proposal.group_id) then
    raise exception 'This group is not currently active';
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

-- =======================================================================
-- Point 11 backfill: existing groups are already 'active' (the default,
-- unchanged for pre-migration rows — pending_review only applies to
-- groups created after this migration) — no update needed. Grandfather
-- existing single-clean-owner arrangements into an approved organiser
-- application. NOT EXISTS-guarded so this is safe to re-run (decision
-- 4) — combined with organiser_applications_one_current_per_user as a
-- hard backstop if it ever isn't. Groups without exactly one active
-- owner are deliberately excluded (surfaced by the preflight notice
-- above, not auto-approved) — their owner(s) can apply through the
-- normal apply_for_organiser_status() flow.
-- =======================================================================
insert into public.organiser_applications (user_id, status, submitted_at, decided_at, decision_reason)
select distinct gm.user_id, 'approved', timezone('utc', now()), timezone('utc', now()),
       'Grandfathered: existing group owner prior to platform-authorisation launch'
from public.group_memberships gm
where gm.role = 'owner' and gm.status = 'active'
  and gm.group_id in (
    select group_id from public.group_memberships
    where role = 'owner' and status = 'active'
    group by group_id having count(*) = 1
  )
  and not exists (
    select 1 from public.organiser_applications oa
    where oa.user_id = gm.user_id and oa.status in ('pending', 'approved', 'suspended')
  );
