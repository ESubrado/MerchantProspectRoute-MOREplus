-- Fresh/reset database baseline: Phase 1 workspace CRM foundation.
-- Apply this phase-level migration only to a new or reset database, in filename order.
begin;

-- Consolidated from 20260903000100_phase_1_workspace_crm_schema.sql.
-- Phase 1 creates only the owned workspace and CRM foundation. Mailboxes,
-- sequences, CSV imports, and sending records intentionally do not exist here.
-- Supabase exposes pgcrypto in the extensions schema; UUID defaults stay owned by Postgres.
create extension if not exists pgcrypto with schema extensions;

-- Membership roles distinguish owners from administrators while preserving a read-only member role.
create type public.workspace_role as enum ('owner', 'admin', 'member');

-- A workspace is the tenant boundary for every mutable CRM record below.
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug),
  unique (id, slug)
);

comment on table public.workspaces is 'Tenant roots. End users cannot create workspaces through RLS; use the controlled bootstrap procedure.';

-- Membership records authorize both the workspace shell and all tenant-scoped data access.
create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  role public.workspace_role not null default 'member',
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_members_revocation_actor_check check (revoked_by is null or revoked_at is not null),
  unique (workspace_id, user_id),
  unique (workspace_id, id)
);

comment on table public.workspace_members is 'Authorization source of truth. A NULL revoked_at marks an active membership.';

-- Companies are scoped to a workspace and may own any number of leads in that same workspace.
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  legal_name text,
  website_url text check (website_url is null or website_url ~* '^https?://'),
  website_domain text check (website_domain is null or website_domain = lower(btrim(website_domain))),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

comment on table public.companies is 'Workspace-owned organizations. The composite key prevents a lead from referencing a company in another tenant.';

-- A lead is a person/contact record; it can be unassociated with a company.
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  company_id uuid,
  full_name text not null check (btrim(full_name) <> ''),
  first_name text,
  last_name text,
  job_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_company_workspace_fk foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete restrict,
  unique (workspace_id, id)
);

comment on table public.leads is 'Workspace-owned CRM contacts. Company ownership is enforced by the workspace_id plus company_id foreign key.';

-- Canonical email values are reusable inside one workspace without sharing contact data across tenants.
create table public.canonical_email_addresses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  validation_status text not null default 'unknown'
    check (validation_status in ('unknown', 'valid', 'invalid', 'risky')),
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email),
  unique (workspace_id, id)
);

comment on table public.canonical_email_addresses is 'Normalized email values and their validation state. Email delivery is outside Phase 1.';

-- Email contact methods link leads to tenant-local canonical email values.
create table public.lead_email_addresses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  lead_id uuid not null,
  canonical_email_address_id uuid not null,
  label text not null default 'work' check (btrim(label) <> ''),
  is_primary boolean not null default false,
  do_not_contact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_email_addresses_lead_workspace_fk foreign key (workspace_id, lead_id)
    references public.leads (workspace_id, id) on delete restrict,
  constraint lead_email_addresses_canonical_workspace_fk foreign key (workspace_id, canonical_email_address_id)
    references public.canonical_email_addresses (workspace_id, id) on delete restrict,
  unique (workspace_id, lead_id, canonical_email_address_id),
  unique (workspace_id, id)
);

comment on table public.lead_email_addresses is 'Lead email contact methods. At most one primary email is allowed per lead.';

-- Phone contact methods use E.164 normalization so they remain comparable without a calling provider.
create table public.lead_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  lead_id uuid not null,
  e164_phone_number text not null check (e164_phone_number ~ '^\\+[1-9][0-9]{1,14}$'),
  label text not null default 'work' check (btrim(label) <> ''),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_phone_numbers_lead_workspace_fk foreign key (workspace_id, lead_id)
    references public.leads (workspace_id, id) on delete restrict,
  unique (workspace_id, lead_id, e164_phone_number),
  unique (workspace_id, id)
);

comment on table public.lead_phone_numbers is 'Tenant-scoped E.164 phone contact methods. Calling workflows are outside Phase 1.';

-- Social contact methods retain the platform and canonical profile URL separately from a lead.
create table public.lead_social_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  lead_id uuid not null,
  platform text not null check (btrim(platform) <> ''),
  profile_url text not null check (profile_url ~* '^https?://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_social_profiles_lead_workspace_fk foreign key (workspace_id, lead_id)
    references public.leads (workspace_id, id) on delete restrict,
  unique (workspace_id, lead_id, platform, profile_url),
  unique (workspace_id, id)
);

comment on table public.lead_social_profiles is 'Tenant-scoped social profile contact methods.';

-- This table stores one current assignee rather than assignment history; changes belong in audit_events.
create table public.lead_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  lead_id uuid not null,
  assigned_to_user_id uuid not null,
  assigned_by_user_id uuid references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_assignments_lead_workspace_fk foreign key (workspace_id, lead_id)
    references public.leads (workspace_id, id) on delete restrict,
  constraint lead_assignments_assignee_workspace_fk foreign key (workspace_id, assigned_to_user_id)
    references public.workspace_members (workspace_id, user_id) on delete restrict,
  unique (workspace_id, lead_id),
  unique (workspace_id, id)
);

comment on table public.lead_assignments is 'One current assignee per lead. An assignment history is recorded as immutable audit events.';

-- Followers allow more than one active workspace member to track a lead.
create table public.lead_followers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  lead_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint lead_followers_lead_workspace_fk foreign key (workspace_id, lead_id)
    references public.leads (workspace_id, id) on delete restrict,
  constraint lead_followers_member_workspace_fk foreign key (workspace_id, user_id)
    references public.workspace_members (workspace_id, user_id) on delete restrict,
  unique (workspace_id, lead_id, user_id),
  unique (workspace_id, id)
);

comment on table public.lead_followers is 'Unique lead followers. The active-membership trigger prevents adding a revoked user.';

-- Audit events are immutable facts written by trusted server/worker commands in the same transaction as a change.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type text not null check (btrim(event_type) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  unique (workspace_id, id)
);

comment on table public.audit_events is 'Append-only tenant audit facts. Direct browser inserts are intentionally denied by RLS.';

-- These indexes serve the tenant-scoped directory, assignment, follower, and audit access patterns.
create index workspace_members_active_user_workspace_idx
  on public.workspace_members (user_id, workspace_id) where revoked_at is null;
create index companies_workspace_name_idx on public.companies (workspace_id, name);
create unique index companies_workspace_website_domain_key
  on public.companies (workspace_id, website_domain) where website_domain is not null;
create index leads_workspace_updated_at_idx on public.leads (workspace_id, updated_at desc);
create index leads_workspace_company_idx on public.leads (workspace_id, company_id) where company_id is not null;
create unique index lead_email_addresses_primary_per_lead_key
  on public.lead_email_addresses (workspace_id, lead_id) where is_primary;
create unique index lead_phone_numbers_primary_per_lead_key
  on public.lead_phone_numbers (workspace_id, lead_id) where is_primary;
create index lead_assignments_workspace_assignee_idx
  on public.lead_assignments (workspace_id, assigned_to_user_id, assigned_at desc);
create index lead_followers_workspace_user_idx on public.lead_followers (workspace_id, user_id);
create index audit_events_workspace_occurred_at_idx on public.audit_events (workspace_id, occurred_at desc);
create index audit_events_workspace_entity_idx
  on public.audit_events (workspace_id, entity_type, entity_id, occurred_at desc);


-- Consolidated from 20260903000200_phase_1_workspace_crm_rls.sql.
-- Phase 1 authorization helpers, integrity triggers, privileges, and RLS policies.
-- The timestamp trigger is shared by every mutable Phase 1 record.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- SECURITY DEFINER avoids RLS recursion while still binding every check to auth.uid().
create or replace function public.is_active_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select auth.uid())
      and membership.revoked_at is null
  );
$$;

-- Manager rights come only from an active owner or admin membership, never from mutable auth metadata.
create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
      and membership.revoked_at is null
  );
$$;

-- Serialize manager demotions and revocations so a workspace never loses its last active owner or admin.
create or replace function public.prevent_last_active_workspace_admin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  removing_active_admin boolean := false;
begin
  if old.role in ('owner', 'admin') and old.revoked_at is null then
    -- NEW is unavailable during DELETE triggers, so determine the transition in separate branches.
    if tg_op = 'DELETE' then
      removing_active_admin := true;
    elsif new.role <> 'admin' or new.revoked_at is not null then
      removing_active_admin := true;
    end if;
  end if;

  if removing_active_admin then
    perform 1
    from public.workspaces
    where id = old.workspace_id
    for update;

    if not exists (
      select 1
      from public.workspace_members as membership
      where membership.workspace_id = old.workspace_id
        and membership.id <> old.id
      and membership.role in ('owner', 'admin')
        and membership.revoked_at is null
    ) then
      raise exception 'A workspace must retain at least one active owner or admin.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

-- Assignment targets must be active members, not merely historical membership rows.
create or replace function public.enforce_active_lead_assignee()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = new.workspace_id
      and membership.user_id = new.assigned_to_user_id
      and membership.revoked_at is null
  ) then
    raise exception 'Lead assignees must be active workspace members.';
  end if;

  return new;
end;
$$;

-- Followers receive the same active-membership protection as assignees.
create or replace function public.enforce_active_lead_follower()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = new.workspace_id
      and membership.user_id = new.user_id
      and membership.revoked_at is null
  ) then
    raise exception 'Lead followers must be active workspace members.';
  end if;

  return new;
end;
$$;

-- Prevent the append-only audit log from becoming editable, even for trusted application paths.
create or replace function public.prevent_audit_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Audit events are immutable.' using errcode = '55000';
  -- The return is unreachable, but PostgreSQL requires every trigger function to declare one.
  return old;
end;
$$;

-- Keep all mutable records' update timestamps authoritative at the database boundary.
create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();
create trigger workspace_members_set_updated_at
before update on public.workspace_members
for each row execute function public.set_updated_at();
create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();
create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();
create trigger canonical_email_addresses_set_updated_at
before update on public.canonical_email_addresses
for each row execute function public.set_updated_at();
create trigger lead_email_addresses_set_updated_at
before update on public.lead_email_addresses
for each row execute function public.set_updated_at();
create trigger lead_phone_numbers_set_updated_at
before update on public.lead_phone_numbers
for each row execute function public.set_updated_at();
create trigger lead_social_profiles_set_updated_at
before update on public.lead_social_profiles
for each row execute function public.set_updated_at();
create trigger lead_assignments_set_updated_at
before update on public.lead_assignments
for each row execute function public.set_updated_at();

-- These checks enforce invariants that a simple foreign key cannot express.
create trigger workspace_members_retain_active_admin
before update or delete on public.workspace_members
for each row execute function public.prevent_last_active_workspace_admin();
create trigger lead_assignments_require_active_assignee
before insert or update on public.lead_assignments
for each row execute function public.enforce_active_lead_assignee();
create trigger lead_followers_require_active_member
before insert or update on public.lead_followers
for each row execute function public.enforce_active_lead_follower();
create trigger audit_events_are_immutable
before update or delete on public.audit_events
for each row execute function public.prevent_audit_event_mutation();

-- RLS is enabled for every tenant-owned table; no policy permits anonymous access.
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.companies enable row level security;
alter table public.leads enable row level security;
alter table public.canonical_email_addresses enable row level security;
alter table public.lead_email_addresses enable row level security;
alter table public.lead_phone_numbers enable row level security;
alter table public.lead_social_profiles enable row level security;
alter table public.lead_assignments enable row level security;
alter table public.lead_followers enable row level security;
alter table public.audit_events enable row level security;

-- Explicit grants make the RLS boundary auditable instead of relying on Supabase defaults.
revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.workspace_members from anon, authenticated;
revoke all on table public.companies from anon, authenticated;
revoke all on table public.leads from anon, authenticated;
revoke all on table public.canonical_email_addresses from anon, authenticated;
revoke all on table public.lead_email_addresses from anon, authenticated;
revoke all on table public.lead_phone_numbers from anon, authenticated;
revoke all on table public.lead_social_profiles from anon, authenticated;
revoke all on table public.lead_assignments from anon, authenticated;
revoke all on table public.lead_followers from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;

grant select, update on table public.workspaces to authenticated;
grant select, insert, update on table public.workspace_members to authenticated;
grant select, insert, update, delete on table public.companies to authenticated;
grant select, insert, update, delete on table public.leads to authenticated;
grant select, insert, update, delete on table public.canonical_email_addresses to authenticated;
grant select, insert, update, delete on table public.lead_email_addresses to authenticated;
grant select, insert, update, delete on table public.lead_phone_numbers to authenticated;
grant select, insert, update, delete on table public.lead_social_profiles to authenticated;
grant select, insert, update, delete on table public.lead_assignments to authenticated;
grant select, insert, delete on table public.lead_followers to authenticated;
grant select on table public.audit_events to authenticated;

-- Authenticated users need these functions only because PostgreSQL evaluates them inside RLS policies.
revoke all on function public.is_active_workspace_member(uuid) from public;
revoke all on function public.is_workspace_admin(uuid) from public;
grant execute on function public.is_active_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;

-- Every active member may read the tenant shell and shared CRM records.
create policy workspaces_select_active_members on public.workspaces
for select to authenticated
using (public.is_active_workspace_member(id));
create policy workspace_members_select_active_members on public.workspace_members
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy companies_select_active_members on public.companies
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy leads_select_active_members on public.leads
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy canonical_email_addresses_select_active_members on public.canonical_email_addresses
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy lead_email_addresses_select_active_members on public.lead_email_addresses
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy lead_phone_numbers_select_active_members on public.lead_phone_numbers
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy lead_social_profiles_select_active_members on public.lead_social_profiles
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy lead_assignments_select_active_members on public.lead_assignments
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy lead_followers_select_active_members on public.lead_followers
for select to authenticated
using (public.is_active_workspace_member(workspace_id));
create policy audit_events_select_active_members on public.audit_events
for select to authenticated
using (public.is_active_workspace_member(workspace_id));

-- Only workspace owners and administrators can change tenant configuration, membership, and CRM records.
create policy workspaces_update_admins on public.workspaces
for update to authenticated
using (public.is_workspace_admin(id))
with check (public.is_workspace_admin(id));
create policy workspace_members_insert_admins on public.workspace_members
for insert to authenticated
with check (public.is_workspace_admin(workspace_id));
create policy workspace_members_update_admins on public.workspace_members
for update to authenticated
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

create policy companies_insert_admins on public.companies
for insert to authenticated
with check (public.is_workspace_admin(workspace_id));
create policy companies_update_admins on public.companies
for update to authenticated
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));
create policy companies_delete_admins on public.companies
for delete to authenticated
using (public.is_workspace_admin(workspace_id));

create policy leads_insert_admins on public.leads
for insert to authenticated
with check (public.is_workspace_admin(workspace_id));
create policy leads_update_admins on public.leads
for update to authenticated
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));
create policy leads_delete_admins on public.leads
for delete to authenticated
using (public.is_workspace_admin(workspace_id));

create policy canonical_email_addresses_insert_admins on public.canonical_email_addresses
for insert to authenticated
with check (public.is_workspace_admin(workspace_id));
create policy canonical_email_addresses_update_admins on public.canonical_email_addresses
for update to authenticated
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));
create policy canonical_email_addresses_delete_admins on public.canonical_email_addresses
for delete to authenticated
using (public.is_workspace_admin(workspace_id));

create policy lead_email_addresses_insert_admins on public.lead_email_addresses
for insert to authenticated
with check (public.is_workspace_admin(workspace_id));
create policy lead_email_addresses_update_admins on public.lead_email_addresses
for update to authenticated
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));
create policy lead_email_addresses_delete_admins on public.lead_email_addresses
for delete to authenticated
using (public.is_workspace_admin(workspace_id));

create policy lead_phone_numbers_insert_admins on public.lead_phone_numbers
for insert to authenticated
with check (public.is_workspace_admin(workspace_id));
create policy lead_phone_numbers_update_admins on public.lead_phone_numbers
for update to authenticated
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));
create policy lead_phone_numbers_delete_admins on public.lead_phone_numbers
for delete to authenticated
using (public.is_workspace_admin(workspace_id));

create policy lead_social_profiles_insert_admins on public.lead_social_profiles
for insert to authenticated
with check (public.is_workspace_admin(workspace_id));
create policy lead_social_profiles_update_admins on public.lead_social_profiles
for update to authenticated
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));
create policy lead_social_profiles_delete_admins on public.lead_social_profiles
for delete to authenticated
using (public.is_workspace_admin(workspace_id));

create policy lead_assignments_insert_admins on public.lead_assignments
for insert to authenticated
with check (public.is_workspace_admin(workspace_id));
create policy lead_assignments_update_admins on public.lead_assignments
for update to authenticated
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));
create policy lead_assignments_delete_admins on public.lead_assignments
for delete to authenticated
using (public.is_workspace_admin(workspace_id));

-- Members may follow or unfollow themselves; workspace owners and administrators may manage any follower relationship.
create policy lead_followers_insert_members_or_admins on public.lead_followers
for insert to authenticated
with check (
  public.is_active_workspace_member(workspace_id)
  and (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id))
);
create policy lead_followers_delete_members_or_admins on public.lead_followers
for delete to authenticated
using (
  public.is_active_workspace_member(workspace_id)
  and (user_id = (select auth.uid()) or public.is_workspace_admin(workspace_id))
);

-- No audit insert/update/delete policy exists: trusted server or worker code must append audited commands.


-- Consolidated from 20260903000500_phase_1_owner_authorization.sql.
-- Phase 1 authorization upgrade: give owners the same management permissions as administrators.
-- This replacement retains the established function name while expanding manager rights to the owner role.
create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
      and membership.revoked_at is null
  );
$$;

-- This replacement prevents revoking or demoting the final active owner or administrator.
create or replace function public.prevent_last_active_workspace_admin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  removing_active_manager boolean := false;
begin
  if old.role in ('owner', 'admin') and old.revoked_at is null then
    if tg_op = 'DELETE' then
      removing_active_manager := true;
    elsif new.role not in ('owner', 'admin') or new.revoked_at is not null then
      removing_active_manager := true;
    end if;
  end if;

  if removing_active_manager then
    perform 1
    from public.workspaces
    where id = old.workspace_id
    for update;

    if not exists (
      select 1
      from public.workspace_members as membership
      where membership.workspace_id = old.workspace_id
        and membership.id <> old.id
        and membership.role in ('owner', 'admin')
        and membership.revoked_at is null
    ) then
      raise exception 'A workspace must retain at least one active owner or admin.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

-- Phase 2 calls this helper at execution time, so its owner permissions update without changing RPC signatures.
comment on function public.is_workspace_admin(uuid) is 'Returns true when auth.uid() is an active workspace owner or administrator.';
comment on function public.prevent_last_active_workspace_admin() is 'Blocks changes that would remove the final active workspace owner or administrator.';


comment on type public.workspace_role is 'Workspace membership roles: owner and admin may manage shared CRM data; members are read-only.';

commit;
