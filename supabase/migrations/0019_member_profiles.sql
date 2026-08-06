-- Member application/registration profiles: personal details, contact
-- information and a single next-of-kin/emergency contact, captured
-- once per (member, group) so a group has the administrative details
-- it needs about who it's actually dealing with. Genuinely sensitive
-- personal data (date of birth, home address, phone, next-of-kin
-- details) — treated accordingly below, following this project's
-- existing "RLS is the real boundary" pattern throughout.
--
-- Design choice: next-of-kin fields are stored as columns on the same
-- row rather than a separate table. There is exactly one next-of-kin
-- contact per profile (not a list), so a join would add complexity
-- with no real benefit — the same reasoning already used elsewhere in
-- this schema for one-to-one data (e.g. loan terms living directly on
-- the `loans` row rather than a side table).

create table public.member_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,

  first_name text not null check (char_length(trim(first_name)) > 0),
  middle_name text,
  last_name text not null check (char_length(trim(last_name)) > 0),
  date_of_birth date not null check (date_of_birth <= (current_date - interval '18 years')),
  gender text check (gender in ('female', 'male', 'non_binary', 'prefer_not_to_say')),

  phone text not null check (char_length(trim(phone)) > 0),
  -- No DB-level format check: no other email column in this schema has
  -- one (profiles.email, group_invitations.email are both plain `text
  -- not null`), Zod validates format on both client and server before
  -- the only real write path (the Server Action) ever runs, and a
  -- regex here risks rejecting an unusual-but-valid address for a
  -- field where "slightly malformed" isn't a security or
  -- financial-integrity issue the way it is elsewhere in this schema.
  email text not null,

  address_line1 text not null check (char_length(trim(address_line1)) > 0),
  address_line2 text,
  city text not null check (char_length(trim(city)) > 0),
  postcode text not null check (char_length(trim(postcode)) > 0),
  country text not null default 'United Kingdom',

  next_of_kin_full_name text not null check (char_length(trim(next_of_kin_full_name)) > 0),
  next_of_kin_relationship text not null check (char_length(trim(next_of_kin_relationship)) > 0),
  next_of_kin_phone text not null check (char_length(trim(next_of_kin_phone)) > 0),
  next_of_kin_email text,

  -- Timestamp, not just a boolean: an auditable consent record, not
  -- merely a UI gate. Set server-side in submitMemberProfileAction()
  -- at the moment of insert, only once the "I confirm the information
  -- is accurate" checkbox has been validated true (informationConfirmed:
  -- z.literal(true) in the Zod schema) — a submission without consent
  -- never reaches this insert at all, and `not null` here means the
  -- database itself cannot hold a profile without it either.
  consent_given_at timestamptz not null,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  -- One profile per member per group — resubmission is an update, not
  -- a new row.
  constraint member_profiles_one_per_group unique (user_id, group_id)
);

comment on table public.member_profiles is
  'Member application/registration data: personal details, contact information, and a single next-of-kin/emergency contact per (user, group). Genuinely sensitive personal data — see RLS policies below.';

create index member_profiles_group_id_idx on public.member_profiles (group_id);

create trigger member_profiles_set_updated_at
  before update on public.member_profiles
  for each row execute function public.set_updated_at();

alter table public.member_profiles enable row level security;

-- A member can always read their own profile. A group's owner or
-- administrator (public.is_group_manager, the same helper used
-- throughout this schema) can read any profile in their group — for
-- administrative purposes, matching the stated requirement exactly.
-- Deliberately narrower than is_group_member/has_group_role with a
-- wider role set: this is personal data, not routine group content,
-- so only the two management roles get read access, not every officer
-- role.
create policy "member_profiles_select_self_or_managers" on public.member_profiles
  for select using (
    user_id = auth.uid() or public.is_group_manager(group_id)
  );

-- A member may only ever create their own profile, and only for a
-- group they're actually an active member of.
create policy "member_profiles_insert_own" on public.member_profiles
  for insert with check (
    user_id = auth.uid() and public.is_group_member(group_id)
  );

-- A member may correct their own profile. Deliberately no manager
-- update policy — the stated requirement is read access for managers,
-- not write access; a member's own personal details should only ever
-- be edited by that member.
create policy "member_profiles_update_own" on public.member_profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- No delete policy, matching this schema's general "no silent removal
-- of a member-facing record" convention — deletion here would need a
-- deliberate, separate account/data-deletion decision, not an
-- incidental policy on this table.
