-- Phase 1 creates only the owned workspace and CRM foundation. Mailboxes,
-- sequences, CSV imports, and sending records intentionally do not exist here.
begin;

-- Supabase exposes pgcrypto in the extensions schema; UUID defaults stay owned by Postgres.
create extension if not exists pgcrypto with schema extensions;

-- Membership roles are deliberately limited to the two roles used by Phase 1.
create type public.workspace_role as enum ('admin', 'member');

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

commit;
