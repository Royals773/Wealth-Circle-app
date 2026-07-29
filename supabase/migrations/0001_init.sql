-- WealthCircle — Phase 1 foundation schema
--
-- WealthCircle is a software-only management system. It never holds,
-- receives, transfers, distributes or initiates movement of members'
-- money. All amounts recorded here describe money that moves through each
-- group's own external bank account; this schema is a record-keeping layer
-- only.
--
-- Conventions used throughout this migration:
--   * All monetary amounts are stored as integer minor units (e.g. pence,
--     cents) in a bigint column, never as floating point.
--   * Every amount column is paired with a currency_code (ISO 4217).
--   * All timestamps are stored in UTC via timestamptz.
--   * Every group-owned table carries a group_id used for tenant isolation.
--   * Completed financial records are never deleted. Corrections are made
--     with a reversal/adjustment row that references the original and
--     records a reason.
--   * Row Level Security is the mandatory tenant isolation boundary for
--     every table below.

-- ---------------------------------------------------------------------
-- Helper: shared updated_at trigger
-- (No extensions are required here: gen_random_uuid() has been a
-- PostgreSQL core function, resolvable via the always-searched
-- pg_catalog schema, since PG13 — no pgcrypto dependency. pgcrypto is
-- installed by 0002_phase2_auth_functions.sql, where it's first needed
-- for invitation token hashing.)
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- profiles
-- One row per authenticated user (auth.users). Holds only display data —
-- never online-banking credentials or full financial credentials.
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- groups
-- A private workspace for one savings group/association.
-- ---------------------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  country_code text not null check (char_length(country_code) = 2),
  currency_code text not null check (char_length(currency_code) = 3),
  contribution_frequency text not null check (
    contribution_frequency in ('weekly', 'biweekly', 'monthly', 'quarterly', 'annually')
  ),
  contribution_type text not null check (contribution_type in ('fixed', 'flexible')),
  financial_year_start_month smallint not null check (
    financial_year_start_month between 1 and 12
  ),
  rules text,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- group_memberships
-- A user's role within one specific group. A user may belong to many
-- groups with a different role in each.
-- ---------------------------------------------------------------------
create table public.group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (
    role in ('owner', 'administrator', 'treasurer', 'loan_officer', 'auditor', 'member')
  ),
  status text not null default 'active' check (status in ('active', 'suspended', 'removed')),
  joined_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (group_id, user_id)
);

create trigger group_memberships_set_updated_at
  before update on public.group_memberships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS helper functions
-- SECURITY DEFINER + fixed search_path so these can be used inside RLS
-- policies (including on group_memberships itself) without recursive
-- policy evaluation.
-- ---------------------------------------------------------------------
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.group_memberships gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.status = 'active'
  );
$$;

create or replace function public.has_group_role(p_group_id uuid, p_roles text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.group_memberships gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.status = 'active'
      and gm.role = any(p_roles)
  );
$$;

-- Roles treated as having management authority over a group's records.
-- 'owner' and 'administrator' can manage everything; other roles are
-- checked explicitly where their authority is narrower.
create or replace function public.is_group_manager(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.has_group_role(p_group_id, array['owner', 'administrator']);
$$;

-- ---------------------------------------------------------------------
-- group_invitations
-- The raw invitation token is never stored — only a SHA-256 hash of it,
-- so a database read (or leak) can never itself be used to accept an
-- invitation. The raw token is generated and returned exactly once, by
-- public.create_invitation() in 0002_phase2_auth_functions.sql, at
-- creation time.
-- ---------------------------------------------------------------------
create table public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  email text not null,
  role text not null check (
    role in ('owner', 'administrator', 'treasurer', 'loan_officer', 'auditor', 'member')
  ),
  token_hash text not null unique,
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'revoked', 'expired')
  ),
  invited_by uuid not null references public.profiles (id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------
-- contribution_plans
-- ---------------------------------------------------------------------
create table public.contribution_plans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null,
  amount_minor_units bigint check (amount_minor_units is null or amount_minor_units > 0),
  currency_code text not null check (char_length(currency_code) = 3),
  frequency text not null check (
    frequency in ('weekly', 'biweekly', 'monthly', 'quarterly', 'annually')
  ),
  is_flexible boolean not null default false,
  start_date date not null,
  end_date date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint contribution_plan_amount_required check (
    is_flexible or amount_minor_units is not null
  )
);

create trigger contribution_plans_set_updated_at
  before update on public.contribution_plans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- contribution_records
-- ---------------------------------------------------------------------
create table public.contribution_records (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  contribution_plan_id uuid references public.contribution_plans (id),
  member_id uuid not null references public.profiles (id),
  amount_minor_units bigint not null check (amount_minor_units > 0),
  currency_code text not null check (char_length(currency_code) = 3),
  period_start date,
  period_end date,
  status text not null default 'pending' check (
    status in (
      'pending', 'submitted', 'verified', 'reconciled', 'partly_paid',
      'paid', 'overdue', 'rejected', 'cancelled', 'reversed'
    )
  ),
  submitted_at timestamptz,
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  reconciled_by uuid references public.profiles (id),
  reconciled_at timestamptz,
  reversal_of uuid references public.contribution_records (id),
  reversal_reason text,
  notes text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint contribution_reconciled_requires_reconciler check (
    status <> 'reconciled' or (reconciled_by is not null and reconciled_at is not null)
  ),
  constraint contribution_reversal_requires_reason check (
    reversal_of is null or reversal_reason is not null
  )
);

create trigger contribution_records_set_updated_at
  before update on public.contribution_records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- withdrawal_requests
-- Records a request to withdraw funds from the group's own external bank
-- account. WealthCircle never initiates the transfer itself.
-- ---------------------------------------------------------------------
create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  requested_by uuid not null references public.profiles (id),
  amount_minor_units bigint not null check (amount_minor_units > 0),
  currency_code text not null check (char_length(currency_code) = 3),
  reason text not null,
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'cancelled', 'paid', 'reversed')
  ),
  requires_dual_approval boolean not null default true,
  approved_by_1 uuid references public.profiles (id),
  approved_at_1 timestamptz,
  approved_by_2 uuid references public.profiles (id),
  approved_at_2 timestamptz,
  paid_at timestamptz,
  reversal_of uuid references public.withdrawal_requests (id),
  reversal_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint withdrawal_dual_approval_distinct check (
    approved_by_1 is null or approved_by_2 is null or approved_by_1 <> approved_by_2
  ),
  constraint withdrawal_reversal_requires_reason check (
    reversal_of is null or reversal_reason is not null
  )
);

create trigger withdrawal_requests_set_updated_at
  before update on public.withdrawal_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- loan_products
-- ---------------------------------------------------------------------
create table public.loan_products (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null,
  description text,
  interest_rate_bps integer not null default 0 check (interest_rate_bps >= 0),
  max_amount_minor_units bigint check (max_amount_minor_units is null or max_amount_minor_units > 0),
  max_term_months integer check (max_term_months is null or max_term_months > 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger loan_products_set_updated_at
  before update on public.loan_products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- loan_applications
-- ---------------------------------------------------------------------
create table public.loan_applications (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  loan_product_id uuid references public.loan_products (id),
  applicant_id uuid not null references public.profiles (id),
  amount_requested_minor_units bigint not null check (amount_requested_minor_units > 0),
  currency_code text not null check (char_length(currency_code) = 3),
  term_months integer not null check (term_months > 0),
  purpose text,
  status text not null default 'pending' check (
    status in ('pending', 'submitted', 'approved', 'rejected', 'cancelled')
  ),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  decision_notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger loan_applications_set_updated_at
  before update on public.loan_applications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- loans
-- ---------------------------------------------------------------------
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  loan_application_id uuid references public.loan_applications (id),
  borrower_id uuid not null references public.profiles (id),
  principal_minor_units bigint not null check (principal_minor_units > 0),
  currency_code text not null check (char_length(currency_code) = 3),
  interest_rate_bps integer not null default 0 check (interest_rate_bps >= 0),
  term_months integer not null check (term_months > 0),
  status text not null default 'approved' check (
    status in (
      'approved', 'disbursed', 'partly_paid', 'paid', 'overdue',
      'defaulted', 'cancelled', 'reversed'
    )
  ),
  disbursed_at timestamptz,
  due_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger loans_set_updated_at
  before update on public.loans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- repayments
-- ---------------------------------------------------------------------
create table public.repayments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  loan_id uuid not null references public.loans (id),
  amount_minor_units bigint not null check (amount_minor_units > 0),
  currency_code text not null check (char_length(currency_code) = 3),
  status text not null default 'submitted' check (
    status in ('submitted', 'verified', 'reconciled', 'cancelled', 'reversed')
  ),
  paid_at timestamptz,
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  reconciled_by uuid references public.profiles (id),
  reconciled_at timestamptz,
  reversal_of uuid references public.repayments (id),
  reversal_reason text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint repayment_reconciled_requires_reconciler check (
    status <> 'reconciled' or (reconciled_by is not null and reconciled_at is not null)
  ),
  constraint repayment_reversal_requires_reason check (
    reversal_of is null or reversal_reason is not null
  )
);

create trigger repayments_set_updated_at
  before update on public.repayments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- approval_requests
-- Generic two-person-approval envelope for sensitive actions across the
-- platform (large withdrawals, loan write-offs, financial corrections,
-- governance decisions that require sign-off).
-- ---------------------------------------------------------------------
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  subject_type text not null check (
    subject_type in (
      'withdrawal_request', 'loan_application', 'governance_proposal',
      'financial_correction', 'member_role_change'
    )
  ),
  subject_id uuid not null,
  requested_by uuid not null references public.profiles (id),
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'cancelled')
  ),
  required_approvals smallint not null default 2 check (required_approvals >= 1),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger approval_requests_set_updated_at
  before update on public.approval_requests
  for each row execute function public.set_updated_at();

-- One decision per approver per approval request — enforces the
-- two-person rule at the schema level via distinct approver rows.
create table public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null references public.approval_requests (id) on delete cascade,
  approver_id uuid not null references public.profiles (id),
  decision text not null check (decision in ('approved', 'rejected')),
  notes text,
  decided_at timestamptz not null default timezone('utc', now()),
  unique (approval_request_id, approver_id)
);

-- ---------------------------------------------------------------------
-- governance_proposals
-- ---------------------------------------------------------------------
create table public.governance_proposals (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  title text not null,
  description text,
  proposed_by uuid not null references public.profiles (id),
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'cancelled')
  ),
  voting_opens_at timestamptz,
  voting_closes_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger governance_proposals_set_updated_at
  before update on public.governance_proposals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- votes
-- ---------------------------------------------------------------------
create table public.votes (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.governance_proposals (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  voter_id uuid not null references public.profiles (id),
  choice text not null check (choice in ('for', 'against', 'abstain')),
  cast_at timestamptz not null default timezone('utc', now()),
  unique (proposal_id, voter_id)
);

-- ---------------------------------------------------------------------
-- documents
-- Metadata only. Actual file bytes belong in Supabase Storage, referenced
-- here by storage_path.
-- ---------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  title text not null,
  description text,
  storage_path text not null,
  related_type text,
  related_id uuid,
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------
-- notifications
-- User-scoped. group_id is nullable because some notifications (e.g. a
-- group invitation) are not yet tied to an active membership.
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id),
  type text not null,
  title text not null,
  body text,
  is_read boolean not null default false,
  related_type text,
  related_id uuid,
  created_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------
-- audit_logs
-- Append-only. group_id is nullable to allow logging account-level
-- actions that are not scoped to a single group.
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

-- =======================================================================
-- Automatic housekeeping triggers
-- =======================================================================

-- Creates a profile row automatically when a new Supabase Auth user signs
-- up, so the rest of the schema can assume every auth.users row has a
-- matching profiles row.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Makes the creator of a group its first "owner" membership row. Runs as
-- SECURITY DEFINER because the group_memberships insert policy otherwise
-- requires an existing manager membership — which cannot exist yet for a
-- brand-new group.
create or replace function public.handle_new_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_memberships (group_id, user_id, role, status)
  values (new.id, new.created_by, 'owner', 'active');
  return new;
end;
$$;

create trigger groups_after_insert_create_owner_membership
  after insert on public.groups
  for each row execute function public.handle_new_group();

-- =======================================================================
-- Row Level Security
-- =======================================================================

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.group_invitations enable row level security;
alter table public.contribution_plans enable row level security;
alter table public.contribution_records enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.loan_products enable row level security;
alter table public.loan_applications enable row level security;
alter table public.loans enable row level security;
alter table public.repayments enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_decisions enable row level security;
alter table public.governance_proposals enable row level security;
alter table public.votes enable row level security;
alter table public.documents enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- profiles: a user can read their own profile and the profiles of people
-- who share at least one group with them; a user can only edit their own.
create policy "profiles_select_self_or_groupmate" on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from public.group_memberships mine
      join public.group_memberships theirs
        on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid()
        and mine.status = 'active'
        and theirs.user_id = public.profiles.id
        and theirs.status = 'active'
    )
  );

create policy "profiles_insert_self" on public.profiles
  for insert with check (id = auth.uid());

create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- groups: visible to members only; creation is open to any authenticated
-- user (they become the owner via group_memberships); updates limited to
-- owners/administrators.
create policy "groups_select_members" on public.groups
  for select using (public.is_group_member(id));

create policy "groups_insert_authenticated" on public.groups
  for insert with check (created_by = auth.uid());

create policy "groups_update_managers" on public.groups
  for update using (public.is_group_manager(id)) with check (public.is_group_manager(id));

-- group_memberships: members can see their group's roster; owners/admins
-- manage membership rows; a user can always see their own membership rows.
create policy "group_memberships_select_groupmates" on public.group_memberships
  for select using (
    user_id = auth.uid() or public.is_group_member(group_id)
  );

-- Deliberately does NOT allow `user_id = auth.uid()` self-insert: that
-- would let any authenticated user add themselves to any group with any
-- role, including 'owner'. The only path for a user to join a group
-- themselves is public.accept_invitation() in
-- 0002_phase2_auth_functions.sql, a SECURITY DEFINER function that
-- validates a specific invitation (role, email match, single-use) before
-- inserting on the user's behalf. The one exception — the creator of a
-- brand-new group — is handled by the groups_after_insert_create_owner_membership
-- trigger below, which also runs as SECURITY DEFINER.
create policy "group_memberships_insert_managers" on public.group_memberships
  for insert with check (public.is_group_manager(group_id));

-- Managers can update OTHER members' rows (e.g. changing role or status),
-- but never their own — this is what prevents an administrator (or owner)
-- from promoting or demoting themselves. Promoting someone else TO
-- 'owner' additionally requires the actor to already be an owner, so an
-- administrator cannot unilaterally create co-owners.
create policy "group_memberships_update_managers" on public.group_memberships
  for update using (
    public.is_group_manager(group_id) and user_id <> auth.uid()
  )
  with check (
    public.is_group_manager(group_id)
    and user_id <> auth.uid()
    and (role <> 'owner' or public.has_group_role(group_id, array['owner']))
  );

-- group_invitations: visible to group managers and to the invited user's
-- own accepted rows; only managers create/update invitations.
create policy "group_invitations_select_managers" on public.group_invitations
  for select using (public.is_group_manager(group_id));

create policy "group_invitations_insert_managers" on public.group_invitations
  for insert with check (public.is_group_manager(group_id));

create policy "group_invitations_update_managers" on public.group_invitations
  for update using (public.is_group_manager(group_id));

-- Generic tenant-isolation policy shape used for the remaining
-- group-owned tables: any active member may read; writers are scoped to
-- the relevant manager/owner roles per table below.

-- contribution_plans
create policy "contribution_plans_select_members" on public.contribution_plans
  for select using (public.is_group_member(group_id));

create policy "contribution_plans_write_treasurers" on public.contribution_plans
  for insert with check (
    public.has_group_role(group_id, array['owner', 'administrator', 'treasurer'])
  );

create policy "contribution_plans_update_treasurers" on public.contribution_plans
  for update using (
    public.has_group_role(group_id, array['owner', 'administrator', 'treasurer'])
  );

-- contribution_records
create policy "contribution_records_select_members" on public.contribution_records
  for select using (public.is_group_member(group_id));

create policy "contribution_records_insert_members" on public.contribution_records
  for insert with check (
    public.is_group_member(group_id)
    and (
      member_id = auth.uid()
      or public.has_group_role(group_id, array['owner', 'administrator', 'treasurer'])
    )
  );

create policy "contribution_records_update_treasurers" on public.contribution_records
  for update using (
    public.has_group_role(group_id, array['owner', 'administrator', 'treasurer'])
  );

-- withdrawal_requests
create policy "withdrawal_requests_select_members" on public.withdrawal_requests
  for select using (public.is_group_member(group_id));

create policy "withdrawal_requests_insert_managers" on public.withdrawal_requests
  for insert with check (
    public.has_group_role(group_id, array['owner', 'administrator', 'treasurer'])
  );

create policy "withdrawal_requests_update_managers" on public.withdrawal_requests
  for update using (
    public.has_group_role(group_id, array['owner', 'administrator', 'treasurer'])
  );

-- loan_products
create policy "loan_products_select_members" on public.loan_products
  for select using (public.is_group_member(group_id));

create policy "loan_products_write_loan_officers" on public.loan_products
  for insert with check (
    public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer'])
  );

create policy "loan_products_update_loan_officers" on public.loan_products
  for update using (
    public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer'])
  );

-- loan_applications
create policy "loan_applications_select_members" on public.loan_applications
  for select using (public.is_group_member(group_id));

create policy "loan_applications_insert_members" on public.loan_applications
  for insert with check (
    public.is_group_member(group_id) and applicant_id = auth.uid()
  );

create policy "loan_applications_update_loan_officers" on public.loan_applications
  for update using (
    public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer'])
    or applicant_id = auth.uid()
  );

-- loans
create policy "loans_select_members" on public.loans
  for select using (public.is_group_member(group_id));

create policy "loans_write_loan_officers" on public.loans
  for insert with check (
    public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer'])
  );

create policy "loans_update_loan_officers" on public.loans
  for update using (
    public.has_group_role(group_id, array['owner', 'administrator', 'loan_officer'])
  );

-- repayments
create policy "repayments_select_members" on public.repayments
  for select using (public.is_group_member(group_id));

create policy "repayments_insert_members" on public.repayments
  for insert with check (public.is_group_member(group_id));

create policy "repayments_update_treasurers" on public.repayments
  for update using (
    public.has_group_role(group_id, array['owner', 'administrator', 'treasurer', 'loan_officer'])
  );

-- approval_requests / approval_decisions
create policy "approval_requests_select_members" on public.approval_requests
  for select using (public.is_group_member(group_id));

create policy "approval_requests_insert_managers" on public.approval_requests
  for insert with check (public.is_group_manager(group_id) or requested_by = auth.uid());

create policy "approval_requests_update_managers" on public.approval_requests
  for update using (public.is_group_manager(group_id));

create policy "approval_decisions_select_members" on public.approval_decisions
  for select using (
    exists (
      select 1 from public.approval_requests ar
      where ar.id = approval_request_id and public.is_group_member(ar.group_id)
    )
  );

create policy "approval_decisions_insert_approvers" on public.approval_decisions
  for insert with check (
    approver_id = auth.uid()
    and exists (
      select 1 from public.approval_requests ar
      where ar.id = approval_request_id and public.is_group_manager(ar.group_id)
    )
  );

-- governance_proposals
create policy "governance_proposals_select_members" on public.governance_proposals
  for select using (public.is_group_member(group_id));

create policy "governance_proposals_insert_members" on public.governance_proposals
  for insert with check (public.is_group_member(group_id) and proposed_by = auth.uid());

create policy "governance_proposals_update_managers" on public.governance_proposals
  for update using (public.is_group_manager(group_id));

-- votes
create policy "votes_select_members" on public.votes
  for select using (public.is_group_member(group_id));

create policy "votes_insert_members" on public.votes
  for insert with check (public.is_group_member(group_id) and voter_id = auth.uid());

-- documents
create policy "documents_select_members" on public.documents
  for select using (public.is_group_member(group_id));

create policy "documents_insert_members" on public.documents
  for insert with check (public.is_group_member(group_id) and uploaded_by = auth.uid());

-- notifications: strictly private to the recipient.
create policy "notifications_select_recipient" on public.notifications
  for select using (recipient_id = auth.uid());

create policy "notifications_update_recipient" on public.notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- audit_logs: append-only and readable by group managers/auditors; no
-- update or delete policies are defined, so audit rows cannot be altered
-- or removed through the API even by group managers.
create policy "audit_logs_select_managers_and_auditors" on public.audit_logs
  for select using (
    group_id is not null
    and public.has_group_role(group_id, array['owner', 'administrator', 'auditor'])
  );

-- actor_id must be null or the caller themselves — prevents a member from
-- forging an audit entry attributed to someone else.
create policy "audit_logs_insert_members" on public.audit_logs
  for insert with check (
    (group_id is null or public.is_group_member(group_id))
    and (actor_id is null or actor_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- Indexes to support tenant-scoped lookups
-- ---------------------------------------------------------------------
create index groups_created_by_idx on public.groups (created_by);
create index group_memberships_group_id_idx on public.group_memberships (group_id);
create index group_memberships_user_id_idx on public.group_memberships (user_id);
create index group_invitations_group_id_idx on public.group_invitations (group_id);
create index group_invitations_token_hash_idx on public.group_invitations (token_hash);
create index contribution_plans_group_id_idx on public.contribution_plans (group_id);
create index contribution_records_group_id_idx on public.contribution_records (group_id);
create index contribution_records_member_id_idx on public.contribution_records (member_id);
create index withdrawal_requests_group_id_idx on public.withdrawal_requests (group_id);
create index loan_products_group_id_idx on public.loan_products (group_id);
create index loan_applications_group_id_idx on public.loan_applications (group_id);
create index loans_group_id_idx on public.loans (group_id);
create index repayments_group_id_idx on public.repayments (group_id);
create index repayments_loan_id_idx on public.repayments (loan_id);
create index approval_requests_group_id_idx on public.approval_requests (group_id);
create index governance_proposals_group_id_idx on public.governance_proposals (group_id);
create index votes_proposal_id_idx on public.votes (proposal_id);
create index documents_group_id_idx on public.documents (group_id);
create index notifications_recipient_id_idx on public.notifications (recipient_id);
create index audit_logs_group_id_idx on public.audit_logs (group_id);
