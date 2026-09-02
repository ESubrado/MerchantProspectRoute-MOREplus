# Database

This folder contains the standalone application's project-owned Supabase/Postgres schema. It never connects to, imports from, or relies on the behavioral reference repository.

## Phase 1 foundation

The versioned migrations in [`migrations`](./migrations) establish the tenant and CRM boundary:

- `20260903000100_phase_1_workspace_crm_schema.sql` defines workspaces, active/revocable admin or member memberships, companies, leads, tenant-local canonical emails, lead email/phone/social methods, current assignments, followers, and immutable audit events.
- `20260903000200_phase_1_workspace_crm_rls.sql` adds timestamps, cross-tenant integrity triggers, least-privilege grants, and Row Level Security.

Every CRM table has a `workspace_id`; composite foreign keys prevent a child record from referring to a parent in another workspace. Admins may change shared CRM data, while members can read their active workspace and follow/unfollow themselves. Audit events are readable in the workspace but are append-only and may be written only by trusted server or worker code that bypasses browser RLS.

Phase 1 deliberately excludes CSV imports, object-storage imports, mailboxes, sequences, email sending, and provider integrations.

## Prerequisites and environment

Create a new, project-owned Supabase project. The web app continues to need only the existing browser-safe values in `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Applying migrations additionally needs a privileged database connection string. Use the existing `DATABASE_URL` placeholder only in a local shell or secret manager; it is not read by the application in Phase 1 and must never be exposed to the browser. A Supabase database password, access token, and service-role key are deployment secrets, not application configuration to commit.

## Apply migrations

Run the files in lexical order against the project's database as the Supabase database owner or another migration role that can create extensions, tables, functions, triggers, and policies. `psql` makes failures stop the deployment immediately:

```powershell
$env:PHASE1_DATABASE_URL = "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
Get-ChildItem database\migrations\*.sql | Sort-Object Name | ForEach-Object {
  psql $env:PHASE1_DATABASE_URL -v ON_ERROR_STOP=1 -f $_.FullName
}
```

Alternatively, submit the same files in order through the Supabase SQL editor while connected as the project database administrator. Do not run these migrations with an `anon`, `authenticated`, or browser-provided credential.

Before deploying the app, verify that the migrations appear in the deployment record and that Row Level Security is enabled:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'workspaces', 'workspace_members', 'companies', 'leads',
    'canonical_email_addresses', 'lead_email_addresses', 'lead_phone_numbers',
    'lead_social_profiles', 'lead_assignments', 'lead_followers', 'audit_events'
  )
order by tablename;
```

## Controlled first-workspace bootstrap

The migrations intentionally create no administrator and provide no client policy to create a workspace or membership. An operator must first create and verify the intended person's email/password account in the project-owned Supabase Auth dashboard (or an approved, server-only provisioning workflow), then use that Auth user UUID in this privileged transaction.

Run the following with `psql` variables; it creates exactly one named workspace, grants that selected existing user the first admin membership, and records the bootstrap. The UUID is supplied at execution time and is not hard-coded in the schema or application.

```powershell
psql $env:PHASE1_DATABASE_URL -v ON_ERROR_STOP=1 `
  --set=workspace_name='Example workspace' `
  --set=workspace_slug='example-workspace' `
  --set=admin_user_id='replace-with-auth-user-uuid' `
  -c @'
begin;
with created_workspace as (
  insert into public.workspaces (name, slug, created_by)
  values (:'workspace_name', :'workspace_slug', :'admin_user_id'::uuid)
  returning id
), created_membership as (
  insert into public.workspace_members (workspace_id, user_id, role)
  select id, :'admin_user_id'::uuid, 'admin'
  from created_workspace
  returning workspace_id
)
insert into public.audit_events (
  workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata
)
select
  workspace_id,
  :'admin_user_id'::uuid,
  'workspace.bootstrapped',
  'workspace',
  workspace_id,
  jsonb_build_object('provisioning', 'controlled')
from created_membership;
commit;
'@
```

The user can then use the existing email/password login UI. The app resolves its workspace name and role from the authorized `workspace_members` row, not Auth metadata. Phase 1 deliberately fails closed if a person has zero or more than one active membership because a workspace-picker UI has not been implemented; assign exactly one active membership until that later feature exists.

To add or revoke people after bootstrap, use a reviewed server-only administrative workflow or a privileged transaction that writes `workspace_members` and an associated `audit_events` row. Never use the Supabase service-role key in client code, and never encode administrator IDs or roles in Auth user metadata.

## Checks

`npm test` runs focused structural regression tests for the migration contract and the workspace-viewer lookup. It does not replace applying the migrations to a disposable Supabase project before production deployment.
