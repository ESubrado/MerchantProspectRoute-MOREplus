# Implementation plan

## Delivered foundation through Phase 5.1

1. Phase 1 established the standalone workspace, membership, CRM, audit, RLS, and owner/admin command boundary.
2. Phases 2–4 added contact lifecycle commands, company/contact relationships, and disabled-by-default durable imports.
3. Phase 5 added externally provisioned mailbox records, audited policy controls, health observations, and dormant atomic capacity reservation primitives.
4. Phase 5.1 adds the campaign boundary: one workspace has exactly one durable campaign; that campaign owns its mailboxes, send policies, sequences, schedules, variants, and enrollments.

## Phase 5.1 invariant

- **One workspace → one campaign** in this release; the campaign is a real durable record rather than a workspace-name alias.
- A `campaigns.workspace_id` uniqueness constraint makes a second campaign impossible in this release, including concurrent requests and authenticated direct SQL writes.
- A workspace-insert trigger creates its campaign during controlled bootstrap. The authorized resolver exists only as an idempotent recovery path for a legacy/interrupted bootstrap; it never accepts a campaign name or creates an additional campaign.
- Mailboxes and send policies carry the campaign key directly. They do not carry a sequence key, so the future router will consider one campaign-wide pooled set of mailboxes.
- Sequence configuration is campaign-owned; a partial unique index permits a contact only one active enrollment across that campaign's sequences.
- The user-facing outreach area exposes sequences for the current campaign only. It does not expose campaign creation, listing, switching, deletion, cross-campaign routing, or a campaign picker.

## Next implementation boundary

The next outreach phase may add manager-controlled step, schedule-window, and variant editing; explicit enrollment controls; then durable routing and dispatch. It must preserve the Phase 5.1 scope checks, choose only from the resolved campaign mailbox pool, and store campaign traceability on routes, attempts, conversations, and metrics directly or through protected parents. It must not enable a provider, worker, webhook, or real email send merely because these configuration tables exist.

## Exact future multi-campaign migration path

1. Preserve all existing `campaigns.id` values and all child rows that already reference them.
2. In a deliberate migration, remove or replace `campaigns_one_per_workspace_key` with a workspace-local campaign identity suitable for multiple rows (such as a unique workspace/campaign slug).
3. Add authorized campaign creation and a membership-authorized current-campaign selection to session/route context. Do not derive selection from arbitrary client input.
4. Update all outreach commands, queries, worker claims, webhook matches, routing, metrics, and audits to take the selected campaign boundary explicitly; retain composite workspace/campaign foreign keys to prevent cross-tenant and cross-campaign joins.
5. Only after isolation, migration, and concurrent-behavior tests pass should the product add a campaign list, switcher, campaign routes, or cross-campaign reporting.

## Deployment checklist for Phase 5.1

1. Apply `20260905000100_phase_5_1_single_campaign_boundary.sql` after all preceding migrations using a privileged migration role.
2. Verify one campaign per workspace and campaign ownership for existing mailbox data before deploying the application.
3. Deploy the application and verify the Mailboxes and Sequences pages resolve the current campaign for an owner/admin and a member.
4. No new application environment variable is needed. Continue to keep `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` browser-safe, and keep `SUPABASE_SERVICE_ROLE_KEY` server-only if a later worker is introduced.
