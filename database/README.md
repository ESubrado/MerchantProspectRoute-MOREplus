# Database

This folder contains the standalone application's project-owned Supabase/Postgres schema. It never connects to, imports from, or relies on the behavioral reference repository.

## Phase 1 foundation

The versioned migrations in [`migrations`](./migrations) provide one clean baseline for each of the six phases. Apply them in filename order only to a fresh or reset database; this set intentionally replaces the prior incremental migration history.

- `20260903000100_phase_1_workspace_crm.sql` defines the workspace CRM schema, ownership roles, tenant integrity, grants, and Row Level Security.
- `20260903000200_phase_2_contacts.sql` adds tenant-checked Contacts commands, lifecycle fields, and first/last-name writes.
- `20260903000300_phase_3_crm.sql` adds Companies and the remaining CRM relationship commands.
- `20260903000400_phase_4_durable_contact_imports.sql` adds disabled-by-default, durable CSV import jobs and private storage.
- `20260903000500_phase_5_mailbox_and_campaign_domain.sql` adds mailbox policy configuration, capacity primitives, and the one-workspace/one-campaign ownership boundary.
- `20260903000600_phase_6_sequence_configuration_drafts.sql` adds validated, campaign-scoped sequence drafts with schedules, pacing, ordered steps, and template variants. It includes the final initial-step, cascading step-deletion, and constraint-resolution behavior.

Every CRM table has a `workspace_id`; composite foreign keys prevent a child record from referring to a parent in another workspace. Owners and admins may change shared CRM data, while members can read their active workspace and follow/unfollow themselves. Audit events are readable in the workspace but are append-only and may be written only by trusted server or worker code that bypasses browser RLS.

Phase 1 deliberately excludes CSV imports, object-storage imports, mailboxes, sequences, email sending, and provider integrations.

## Phase 2 Contacts

The Contacts screen uses `crm_search_contacts` for server-side search, filters, and pagination. Owner-or-admin `crm_create_contact` and `crm_update_contact` commands atomically write the lead, optional primary email relationship, and audit event. The application rechecks the active workspace membership in its server data layer; each database command independently verifies it again before reading or writing.

Apply `20260903000200_phase_2_contacts.sql` after Phase 1 and before deploying the Contacts code. There are no new application environment variables or Supabase browser credentials. A missing migration produces an actionable Contacts error state rather than falling back to dummy data.

## Phase 3 CRM and Companies

Phase 3 makes the Companies route database-backed and completes the CRM relationship commands used in the Contacts drawer. Apply `20260903000300_phase_3_crm.sql` after every earlier migration before deploying the Phase 3 application code. The migration adds optional company phone/address values, an in-workspace normalized company-name uniqueness rule, and transactional commands that independently authorize every request. Email DNC is stored on `leads`; a change to it writes a dedicated immutable audit event. No additional application environment variables are required.

## Phase 4 durable CSV imports

Phase 4 adds a project-owned private `contact-imports` bucket, disabled-by-default workspace import setting, durable contact-import job records, bounded row errors, service-role worker claims, resumable batches, counters, and 30-day source cleanup. The Contacts button is intentionally disabled with an **Imports coming soon** explanation. That presentation is backed by the database: job creation remains denied unless a database owner enables a workspace after deploying the worker.

Apply `20260903000400_phase_4_durable_contact_imports.sql` after all earlier migrations. Import jobs, Storage uploads, and service-role worker access require the additional server-only `SUPABASE_SERVICE_ROLE_KEY`; it must never be exposed as a `NEXT_PUBLIC_` value. See [the Phase 4 import runbook](../docs/contact-import-runbook.md) for mapping, dedupe, file-limit, retention, scheduler, recovery, and staged-enable requirements.

## Phase 5 mailbox and campaign domain

Apply `20260903000500_phase_5_mailbox_and_campaign_domain.sql` after every earlier migration and before deploying the Phase 5 Mailboxes UI. It creates no mailbox provider connection, provider credential, webhook, sender, queue, worker, cron task, health-source integration, or health-trigger automation.

After deployment, a workspace owner or admin can use **Outreach → Mailboxes → Record mailbox** to register an already externally provisioned address, choose its local-day IANA timezone, set its hard daily capacity and optional ramp, and explicitly activate or pause the record. A manual pause requires a reason, forces the mailbox to paused, blocks all future capacity reservations, and is only cleared by a subsequent audited configuration update. The application never provisions the actual mailbox and never sends email in Phase 5.

The migration includes dormant, service-role-only `mailbox_reserve_daily_capacity` and `mailbox_finalize_daily_capacity` commands. They lock mailbox and daily usage state, require a unique request key, and protect `reserved_count + consumed_count` against the calculated local-day capacity. Do not grant these commands to `authenticated`, call them from the browser, or run a sender until a separate dispatch phase defines queue, provider, retry, release/consume, and audit behavior.

There are **no new environment variables** for Phase 5. Continue to keep the existing public Supabase URL/anon key browser-safe and any service-role credential server-only; Phase 5 does not require setting `SUPABASE_SERVICE_ROLE_KEY` because it deploys no capacity worker.

### Single campaign boundary

The same Phase 5 migration creates a project-owned `campaigns` table with a `unique (workspace_id)` restriction. This is the deliberate release boundary: every workspace has exactly one campaign, and a second campaign fails even under a concurrent insert attempt. Authenticated roles receive read-only table access; the application exposes no campaign create, list, switch, rename, or delete UI/API.

The migration backfills a campaign for every existing workspace and adds an `after insert` workspace trigger, so the controlled bootstrap transaction automatically creates the sole campaign. The application also invokes an idempotent, membership-authorized campaign resolver before mailbox or sequence access. That resolver can repair only a missing campaign for an already-authorized workspace; it accepts no campaign name and cannot make a second one.

Mailboxes and sending policies now contain the campaign key directly and are enforced by composite foreign keys. A mailbox intentionally has no sequence key: all of a campaign's mailboxes form the one future routing pool. The migration also stores many campaign-owned sequences, schedules, ordered steps, variants, and contact enrollments. A partial unique index on `(workspace_id, lead_id) where status = 'active'` prevents one contact from having concurrent active enrollments in different sequences.

The sequence creation flow creates inert drafts and an empty schedule only. Phase 5 does not implement step/variant/schedule-window editing, enrollment UI, a scheduler, routing, sending, a provider, webhooks, or a campaign UI. There are **no new environment variables** for Phase 5.

The later multi-campaign migration must preserve all existing campaign IDs and linked records, deliberately relax `campaigns_one_per_workspace_key`, add an authorized campaign selection mechanism, and only then add campaign UI/routing/metrics behavior. See [the implementation plan](../docs/implementation-plan.md) and [target architecture](../docs/target-architecture.md) for the exact sequence.

After applying the migration, verify the release invariant before deploying the application:

```sql
select workspace_id, count(*) as campaign_count
from public.campaigns
group by workspace_id
having count(*) <> 1;

select conname
from pg_constraint
where conrelid = 'public.campaigns'::regclass
  and conname = 'campaigns_one_per_workspace_key';

select indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'sequence_enrollments'
  and indexname = 'sequence_enrollments_one_active_lead_per_workspace_key';
```

The first query must return no rows; the latter two must each return one row.

## Phase 6 sequence configuration drafts

Apply `20260903000600_phase_6_sequence_configuration_drafts.sql` after every earlier migration and before deploying the Phase 6 Sequences UI. It gives every sequence at most one campaign-owned schedule policy, with a validated IANA timezone, up to 42 non-overlapping weekday windows, a future hourly throttle, and a future jitter maximum. It also makes template subjects and bodies first-class stored fields, while retaining the existing provider-neutral JSON snapshot for compatibility. Every newly created sequence receives one zero-delay step. Deleting any non-final step cascades deletion to its owned variants, records the count in the audit event, and closes the remaining positional gap transactionally.

Owners and admins can edit only drafts or paused sequences. Each configuration command resolves the one campaign from active workspace membership, checks the manager role again in the database, locks its owned sequence, and writes an audit event. Reordering locks the sequence and checks that the supplied list contains every current step exactly once before a deferred unique-position constraint commits the new order. Activating locks the schedule, steps, and variants, then requires at least one weekly window, contiguous positions beginning at 1, and at least one complete subject/body variant on every step. Archived sequences are retained as read-only records.

An active sequence is still **configuration only**. Phase 6 deploys no routing, enrollment state machine, mailbox selection, provider adapter, scheduler, queue, worker, webhook, rendering, send attempt, or email send path. The earlier authenticated enrollment helpers are revoked so an active configuration cannot be presented as a runnable automation. Do not grant those commands back or connect a provider as part of this release.

There are **no new environment variables** for Phase 6. Apply the migration with the same privileged database role used for earlier migrations, deploy the web application, then verify a manager can save valid schedule/step/variant configuration, invalid overlapping windows and incomplete activation fail, and all Sequences states visibly show **Automation not configured**. A normal member should remain read-only.

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
    'lead_social_profiles', 'lead_assignments', 'lead_followers', 'audit_events',
    'campaigns', 'mailboxes', 'mailbox_sending_policies', 'mailbox_daily_usage',
    'mailbox_capacity_reservations', 'mailbox_health_observations',
    'campaign_sequences', 'campaign_sequence_schedules', 'campaign_sequence_steps',
    'campaign_sequence_step_variants', 'sequence_enrollments'
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

The workspace-insert trigger from Phase 5 creates the workspace's sole campaign in the same transaction. The user can then use the existing email/password login UI. The app resolves its workspace name and role from the authorized `workspace_members` row, not Auth metadata, then resolves the only campaign before outreach configuration. Phase 1 fails closed when a person has no active membership. Until a workspace-picker UI exists, the app deterministically chooses that person's oldest active membership when more than one is present.

To add or revoke people after bootstrap, use a reviewed server-only administrative workflow or a privileged transaction that writes `workspace_members` and an associated `audit_events` row. Never use the Supabase service-role key in client code, and never encode administrator IDs or roles in Auth user metadata.

## Checks

`npm test` runs focused structural regression tests for the migration contract and the workspace-viewer lookup. It does not replace applying the migrations to a disposable Supabase project before production deployment.
