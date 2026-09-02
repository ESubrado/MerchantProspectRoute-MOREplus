-- Phase 1 authorization helpers, integrity triggers, privileges, and RLS policies.
begin;

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

commit;
