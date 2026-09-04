# Implementation plan

## Delivered foundation through Phase 6

1. Phase 1 established the standalone workspace, membership, CRM, audit, RLS, and owner/admin command boundary.
2. Phases 2–4 added contact lifecycle commands, company/contact relationships, and disabled-by-default durable imports.
3. Phase 5 added externally provisioned mailbox records, audited policy controls, health observations, dormant atomic capacity reservation primitives, and the one-workspace/one-campaign boundary. That campaign owns its mailboxes, send policies, sequences, schedules, variants, and enrollments.
5. Phase 6 replaces the Sequences prototype with campaign-owned draft configuration: IANA timezones, non-overlapping weekly time windows, throttle and jitter policies, ordered steps, and provider-neutral subject/body variants. Managers can activate only a transactionally complete configuration, pause it for editing, or archive it.

## Phase 5 campaign invariant

- **One workspace → one campaign** in this release; the campaign is a real durable record rather than a workspace-name alias.
- A `campaigns.workspace_id` uniqueness constraint makes a second campaign impossible in this release, including concurrent requests and authenticated direct SQL writes.
- A workspace-insert trigger creates its campaign during controlled bootstrap. The authorized resolver exists only as an idempotent recovery path for a legacy/interrupted bootstrap; it never accepts a campaign name or creates an additional campaign.
- Mailboxes and send policies carry the campaign key directly. They do not carry a sequence key, so the future router will consider one campaign-wide pooled set of mailboxes.
- Sequence configuration is campaign-owned; a partial unique index permits a contact only one active enrollment across that campaign's sequences.
- The user-facing outreach area exposes sequences for the current campaign only. It does not expose campaign creation, listing, switching, deletion, cross-campaign routing, or a campaign picker.

## Phase 6 automation boundary

An **active** sequence means its configuration passes validation; it does not mean that work can run. Automation is not configured: there is no enrollment state machine, route selection, provider adapter, scheduler, queue, worker, webhook, or send attempt in this phase. The legacy authenticated enrollment RPC is revoked so a configuration state cannot be mistaken for a runnable lead state.

The next outreach phase may add an explicit enrollment state machine, durable routing and then scheduling/dispatch. It must preserve the Phase 5 scope checks, choose only from the resolved campaign mailbox pool, store campaign traceability on routes, attempts, conversations, and metrics directly or through protected parents, and define idempotency, provider, retry, cancellation, DNC/reply/bounce, capacity, throttle, jitter, and auditing behavior before any sends are enabled.

## Deployment checklist for Phase 6

1. Apply the six fresh/reset baseline migrations through `20260903000600_phase_6_sequence_configuration_drafts.sql` using the privileged migration role.
2. Verify `campaign_sequence_schedules_sequence_key` and the deferrable `campaign_sequence_steps_position_key` exist before deployment.
3. Deploy the application and confirm that an owner/admin can configure a draft, that invalid overlap/order/activation cases fail, and that a member can only review configuration.
4. Confirm the Sequences screen visibly reports **Automation not configured** for every state. Do not grant the revoked enrollment commands back, wire a provider, or deploy a scheduler as part of this release.
5. No new environment variables are required. Continue to keep `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` browser-safe, and keep `SUPABASE_SERVICE_ROLE_KEY` server-only for future worker work.

## Exact future multi-campaign migration path

1. Preserve all existing `campaigns.id` values and all child rows that already reference them.
2. In a deliberate migration, remove or replace `campaigns_one_per_workspace_key` with a workspace-local campaign identity suitable for multiple rows (such as a unique workspace/campaign slug).
3. Add authorized campaign creation and a membership-authorized current-campaign selection to session/route context. Do not derive selection from arbitrary client input.
4. Update all outreach commands, queries, worker claims, webhook matches, routing, metrics, and audits to take the selected campaign boundary explicitly; retain composite workspace/campaign foreign keys to prevent cross-tenant and cross-campaign joins.
5. Only after isolation, migration, and concurrent-behavior tests pass should the product add a campaign list, switcher, campaign routes, or cross-campaign reporting.

## Deployment checklist for the Phase 5 campaign boundary

1. Apply the fresh/reset baseline through `20260903000500_phase_5_mailbox_and_campaign_domain.sql` using a privileged migration role.
2. Verify one campaign per workspace and campaign ownership for existing mailbox data before deploying the application.
3. Deploy the application and verify the Mailboxes and Sequences pages resolve the current campaign for an owner/admin and a member.
4. No new application environment variable is needed. Continue to keep `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` browser-safe, and keep `SUPABASE_SERVICE_ROLE_KEY` server-only if a later worker is introduced.
