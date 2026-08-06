-- Group constitution: versioned, PDF-based governing documents that
-- owners/administrators publish and members must acknowledge before
-- reaching the rest of a group's functionality. Genuinely new work —
-- the pre-existing groups.rules free-text column is a different,
-- unversioned, unacknowledged field and is not extended or reused
-- here.
--
-- Two tables:
--   group_constitutions        — one row per published version. Binary
--                                 PDF lives in Supabase Storage (bucket
--                                 "constitutions"); this row only ever
--                                 stores the storage path, never the
--                                 file itself. Immutable once published
--                                 — no update or delete policy — a
--                                 correction is a new version, the same
--                                 "roll forward, never revert" pattern
--                                 this project's own migration history
--                                 already follows.
--   constitution_acknowledgements — one row per (user, specific
--                                 version) they signed. Also immutable
--                                 — an acknowledgement is a fact about
--                                 a point in time, never edited.
--
-- Every statement below is idempotent (create table if not exists,
-- create index if not exists, drop policy if exists before each create
-- policy, create or replace function, on conflict do nothing for the
-- bucket insert) so the whole file can be safely re-pasted and re-run
-- end to end. This was added after the first staging apply left a
-- genuinely partial result: the two tables above were created, but
-- the storage section at the bottom (bucket + storage.objects
-- policies) silently didn't run, discovered only by independently
-- querying the bucket afterward rather than trusting the editor's
-- "Success" message — the same failure mode already recorded once for
-- migration 0018 in docs/phase-9-smoke-test.md. See
-- docs/phase-10-plan.md's migration-application note for the standing
-- convention this prompted for future migrations (wrapping in
-- BEGIN/COMMIT so a mid-file error can't leave a partial apply at
-- all).

create table if not exists public.group_constitutions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  version integer not null check (version > 0),
  storage_path text not null,
  title text not null check (char_length(trim(title)) > 0),
  note text,
  published_by uuid not null references public.profiles (id),
  published_at timestamptz not null default timezone('utc', now()),
  unique (group_id, version)
);

comment on table public.group_constitutions is
  'One row per published version of a group''s governing document. storage_path references the Supabase Storage "constitutions" bucket (path convention: <group_id>/<random-uuid>.pdf, deliberately not version-encoded — the upload happens before the version number is assigned) — the PDF binary itself is never stored here. Immutable once inserted: no update or delete policy.';

create index if not exists group_constitutions_group_id_idx on public.group_constitutions (group_id);

alter table public.group_constitutions enable row level security;

-- Any active member of the group (any role) can see every published
-- version, including past ones — matches "members can view their
-- group's current constitution" plus lets the acknowledgement banner
-- compare "latest version" against what a member last signed.
drop policy if exists "group_constitutions_select_members" on public.group_constitutions;
create policy "group_constitutions_select_members" on public.group_constitutions
  for select using (
    public.is_group_member(group_id)
  );

-- Only owners/administrators can publish, and only ever as themselves.
-- No update or delete policy anywhere on this table — a published
-- version is permanent; the only way to "fix" one is a new version via
-- publish_group_constitution() below, which enforces sequential
-- versioning itself.
drop policy if exists "group_constitutions_insert_managers" on public.group_constitutions;
create policy "group_constitutions_insert_managers" on public.group_constitutions
  for insert with check (
    public.is_group_manager(group_id) and published_by = auth.uid()
  );

create table if not exists public.constitution_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  constitution_id uuid not null references public.group_constitutions (id) on delete cascade,
  acknowledged_at timestamptz not null default timezone('utc', now()),
  unique (user_id, constitution_id)
);

comment on table public.constitution_acknowledgements is
  'One row per (user, specific constitution version) acknowledged. Immutable — an acknowledgement is a record of a fact, never edited or revoked through the API.';

create index if not exists constitution_acknowledgements_group_id_idx on public.constitution_acknowledgements (group_id);
create index if not exists constitution_acknowledgements_user_id_idx on public.constitution_acknowledgements (user_id);

alter table public.constitution_acknowledgements enable row level security;

-- Deliberately self-only, no manager exception: "no one reads another
-- member's acknowledgements" is an explicit requirement, not an
-- oversight — unlike member_profiles (0019), where managers get
-- read access, that was a different, explicit requirement for that
-- feature. This one is narrower on purpose.
drop policy if exists "constitution_acknowledgements_select_own" on public.constitution_acknowledgements;
create policy "constitution_acknowledgements_select_own" on public.constitution_acknowledgements
  for select using (
    user_id = auth.uid()
  );

-- A member may only ever acknowledge as themselves, for a constitution
-- version that actually belongs to a group they're an active member
-- of — the subquery ties group_id and constitution_id together so a
-- caller can't claim to acknowledge group B's constitution while
-- writing group_id = A, or vice versa.
drop policy if exists "constitution_acknowledgements_insert_own" on public.constitution_acknowledgements;
create policy "constitution_acknowledgements_insert_own" on public.constitution_acknowledgements
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.group_constitutions gc
      where gc.id = constitution_id
        and gc.group_id = constitution_acknowledgements.group_id
        and public.is_group_member(gc.group_id)
    )
  );

-- No update or delete policy on either table.

-- =======================================================================
-- publish_group_constitution: the only way a new version is ever
-- created. SECURITY INVOKER (relies on the insert RLS policy above for
-- the real enforcement, same as almost every other write RPC in this
-- schema) — exists to make version-numbering atomic and centralized
-- (never client-computed, which could race or duplicate) and to write
-- the same audit_logs + create_notification pattern every other
-- lifecycle event in this schema follows.
-- =======================================================================
create or replace function public.publish_group_constitution(
  p_group_id uuid,
  p_storage_path text,
  p_title text,
  p_note text default null
)
returns table (id uuid, version integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_next_version integer;
  v_id uuid;
  v_group_name text;
  v_member record;
begin
  if not public.is_group_manager(p_group_id) then
    raise exception 'Only owners and administrators can publish a constitution';
  end if;

  -- Qualified as group_constitutions.version, not just version: the
  -- function's own `returns table (id uuid, version integer)` clause
  -- creates an implicit PL/pgSQL variable named version in scope here,
  -- which an unqualified reference is ambiguous against — a real bug
  -- caught live (42702 "column reference is ambiguous") when this was
  -- first exercised against staging, not just a hypothetical.
  select coalesce(max(group_constitutions.version), 0) + 1 into v_next_version
  from public.group_constitutions
  where group_id = p_group_id;

  insert into public.group_constitutions (group_id, version, storage_path, title, note, published_by)
  values (p_group_id, v_next_version, p_storage_path, p_title, p_note, auth.uid())
  returning group_constitutions.id into v_id;

  insert into public.audit_logs (group_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_group_id, auth.uid(), 'constitution_published', 'group_constitutions', v_id,
    jsonb_build_object('version', v_next_version, 'title', p_title)
  );

  -- Notify every active member a new version exists — the same
  -- lifecycle-notification pattern used everywhere else in this
  -- schema. Non-blocking by design: this only ever informs, it never
  -- gates access (that's the banner/acknowledgement-status check in
  -- application code, not this function).
  select name into v_group_name from public.groups where groups.id = p_group_id;
  for v_member in
    select gm.user_id from public.group_memberships gm
    where gm.group_id = p_group_id and gm.status = 'active'
  loop
    perform public.create_notification(
      v_member.user_id, p_group_id, 'governance', 'constitution_published',
      'A new version of ' || v_group_name || '''s constitution is available',
      'Version ' || v_next_version || ' has been published. Review it and re-acknowledge when you have a chance — your existing access is not affected.',
      'group_constitutions', v_id,
      'constitution_published:' || v_id || ':' || v_member.user_id
    );
  end loop;

  return query select v_id, v_next_version;
end;
$$;

revoke all on function public.publish_group_constitution(uuid, text, text, text) from public;
grant execute on function public.publish_group_constitution(uuid, text, text, text) to authenticated;

-- =======================================================================
-- acknowledge_group_constitution: idempotent (on conflict do nothing,
-- the same dedupe pattern as create_notification's dedupe_key) — an
-- accidental double-click can never create two rows or error.
-- =======================================================================
create or replace function public.acknowledge_group_constitution(p_constitution_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from public.group_constitutions where id = p_constitution_id;
  if v_group_id is null then
    raise exception 'Constitution not found';
  end if;
  if not public.is_group_member(v_group_id) then
    raise exception 'Not a member of this group';
  end if;

  insert into public.constitution_acknowledgements (user_id, group_id, constitution_id)
  values (auth.uid(), v_group_id, p_constitution_id)
  on conflict (user_id, constitution_id) do nothing;
end;
$$;

revoke all on function public.acknowledge_group_constitution(uuid) from public;
grant execute on function public.acknowledge_group_constitution(uuid) to authenticated;

-- =======================================================================
-- Storage: a private "constitutions" bucket, path convention
-- <group_id>/<random-uuid>.pdf (not version-encoded — see the
-- group_constitutions table comment above). Not public — every access, including
-- generating a signed download URL, goes through these RLS policies on
-- storage.objects, reusing the exact same is_group_member/
-- is_group_manager functions as the table policies above, so table
-- access and file access can never disagree about who's authorized.
-- storage.foldername(name) splits the object path into segments; the
-- first segment is the group_id by construction.
-- =======================================================================
-- file_size_limit is defense-in-depth only, matching the 20MB cap
-- enforced in src/lib/validations/constitution.ts. Deliberately no
-- allowed_mime_types here — that check trusts the client-supplied
-- Content-Type header, the same spoofable signal the app-layer
-- hasPdfMagicBytes() check was added to replace. Real type
-- enforcement stays server-side, not bucket-side.
insert into storage.buckets (id, name, public, file_size_limit)
values ('constitutions', 'constitutions', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "constitutions_storage_select_members" on storage.objects;
create policy "constitutions_storage_select_members" on storage.objects
  for select using (
    bucket_id = 'constitutions'
    and public.is_group_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "constitutions_storage_insert_managers" on storage.objects;
create policy "constitutions_storage_insert_managers" on storage.objects
  for insert with check (
    bucket_id = 'constitutions'
    and public.is_group_manager(((storage.foldername(name))[1])::uuid)
  );

-- No update or delete storage policy — matches the table-level
-- immutability; a correction is a new object at a new version's path,
-- never an overwrite.
