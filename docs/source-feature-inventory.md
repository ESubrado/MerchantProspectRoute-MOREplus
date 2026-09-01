# Source feature inventory

## Reference boundary

- **Reference repository:** `C:\GitRepositories\Merchant-outbound-routing-engine`
- **Inspected revision:** `af98b0aade26394a80395b1ff81c29d22a375fd9`
- **Use:** product and implementation reference only. No source file, package, runtime import, symlink, environment value, database, storage bucket, or deployed function is a dependency of this project.
- **Scope:** CRM (contacts/leads, companies, contact methods, assignment/followers, DNC/reply temperature, search, CSV import) and cold-email outreach (mailboxes, sending policies, sequences, steps, variants, lead routing, send state/history, replies, and inbox).

The source is a Next 16 / React 19 application with Supabase client calls. It contains pages, client components, server actions, and query adapters. It does **not** contain Supabase migrations, RLS policies, SQL function bodies, Storage configuration, Edge Function source, queue workers, cron configuration, or external-provider integration code. `lib/database.types.ts` is therefore a generated-contract snapshot, not implementation evidence.

## Implementation-status key

| Status | Meaning |
| --- | --- |
| Present in source | A UI, query, or server-action implementation is checked in. This does not imply its remote backend exists in this repository. |
| Remote contract only | The source invokes an RPC/Edge Function or relies on a database behavior, but no implementation is checked in. |
| Generated types only | Declared in `lib/database.types.ts` but neither queried nor invoked by the source application. |
| Excluded | Outside the requested product scope. |

## In-scope product capabilities

| Area | Present in source | Remote contract only / missing implementation |
| --- | --- | --- |
| Contacts / leads | Paginated contacts grid; sort, debounced search, reply-temperature filters; detail drawer; manual lead creation; email, phone, and social-link add/remove. | RLS, normalization triggers, uniqueness rules, shared-email resolution RPC, `lead_directory` view, and search RPC. The source UI does not edit lead name/company or delete a lead. |
| Companies | Paginated/sortable/searchable company grid; drawer with linked contacts; edit name, website, phone, address. | `company_directory` view, search RPC, phone normalization trigger, uniqueness/RLS. |
| Ownership | Replace-style single assignee; add/remove followers; member display-name lookup. | Authorization policies and workspace-membership enforcement. |
| Reply temperature / DNC | Values: neutral (0), interested (1), auto-reply (2), DNC (3), reschedule (4), or unlabeled. Manual DNC selection also sets `leads.email_dnc`. | Automatic reply classification and automatic DNC/sequence stopping are not present in source. |
| CSV import | Field mapping for first/last/full name, email, phone, company, company website, LinkedIn, ignore; CSV upload; job polling, retry on stalled job, result counts. | Storage policy; import worker; file parsing, validation, dedupe, company creation, job progress, and resume semantics. |
| Mailboxes | Admin mailbox list/search/sort; active toggle; visible EmailEngine identifier, provider type, and Warmy health metrics; workspace deliverability threshold; per-mailbox send-policy editor. | Mailbox provisioning/connection, Warmy ingestion, health-trigger behavior, policy validation/defaults. |
| Sequences | Admin can create, edit, activate/pause/archive a sequence; add/update/delete/reorder steps; configure delay, days, time window, timezone, throttle, jitter; add/update/delete/enable A/B variants; activity and aggregate metrics. | Status/reorder RPCs; stats views; dispatch/scheduling worker; template rendering; rate enforcement; provider send, retries, bounces, and metrics production. |
| Lead routing and execution | View assigned mailbox, current sequence state and send-attempt timeline; assign/reassign mailbox; start, stop, and resume sequence execution. | Route-selection logic, immutable audit event creation, state-machine transitions, queue/delivery machinery. |
| Replies / inbox | Unified inbox shows only conversations with an inbound message; unread count/filter/search in the client; lead and conversation views; mark read; sanitized HTML/plain-text rendering; attachment download; reply/forward composer with recipients, links and up to 10 MB of new attachments. | Inbound provider/webhook synchronization, conversation and lead matching, attachment ingestion/storage, reply classification, `send-message` Edge Function, provider authorization and persistence of outbound messages. |

## Source routes

All listed routes are page routes; this source contains no `app/api/**/route.ts` handlers.

| URL | Source route | Scope and behavior | Status |
| --- | --- | --- | --- |
| `/login` | `app/login/page.tsx` | Password login screen. | Present; cross-cutting foundation |
| `/` | `app/(inbox)/page.tsx` | Empty inbox-reader state. The enclosing layout loads the conversation list. | Present |
| `/c/[conversationId]` | `app/(inbox)/c/[conversationId]/page.tsx` | Thread reader, marks read, renders composer. | Present |
| `/lead/[leadId]` | `app/(inbox)/lead/[leadId]/page.tsx` | Lead inbox, temperature, company/contact links, execution panel, lead conversations. | Present |
| `/contacts` | `app/(inbox)/contacts/page.tsx` | Contact grid, drawer, import, and manual creation entry points. | Present |
| `/companies` | `app/(inbox)/companies/page.tsx` | Company grid and drawer. | Present |
| `/mailboxes` | `app/(inbox)/mailboxes/page.tsx` | Admin mailbox grid. | Present |
| `/sequences` | `app/(inbox)/sequences/page.tsx` | Admin single-current-sequence editor and activity chart. The page displays the first non-archived sequence even though backend APIs support many. | Present |
| `/settings` | `app/(inbox)/settings/page.tsx` | Admin staff and mailbox deliverability settings. Staff is outside target scope; mailbox settings are in scope. | Mixed |

`app/(inbox)/layout.tsx` is an involved shared route layout: it requires a viewer, preloads conversations and workspace members, and renders the application/sidebar shell. `proxy.ts` refreshes Supabase auth cookies and redirects between protected routes and `/login`.

## In-scope product components

The following custom components are involved in the requested scope. Shared `components/ui/*` primitives, `theme-provider.tsx`, and `hooks/use-mobile.ts` are presentation infrastructure rather than product behavior.

| Component(s) | Responsibility | Status |
| --- | --- | --- |
| `inbox-shell`, `inbox-header`, `app-sidebar`, `nav-user` | Authenticated shell, navigation, conversation sidebar, client-only unread/search/temperature filtering, lazy conversation page load, logout. | Present |
| `contacts-table`, `contact-drawer`, `add-lead-drawer`, `lead-link` | Contact list/detail/create and in-place assignment, followers, methods, social links, temperature, and conversation access. | Present |
| `companies-table`, `company-drawer`, `company-link` | Company list/detail/update and links to contacts. | Present |
| `bulk-import-dialog`, `import-status-pill` | Mapping UX, job progress, outcome and re-adoption notification. | Present |
| `lead-temperature`, `temperature-picker` | Temperature labels, filters, gradient, and optimistic change control. | Present |
| `social-platform-icon`, `email-provider-icon` | Contact social and mailbox provider presentation. | Present |
| `mailboxes-table`, `mailbox-drawer`, `mailbox-settings` | Mailbox management, health display, send-policy configuration, deliverability auto-toggle threshold. | Present |
| `create-first-sequence`, `sequence-editor`, `sequence-activity-chart` | Sequence creation, status, steps, variants, operational metrics and chart. | Present |
| `lead-sequence-panel` | Per-lead route, execution state, attempt history and sequence controls. | Present |
| `lead-conversations`, `thread-messages`, `mark-read`, `attachment-chip`, `message-composer` | Conversation list/thread display, read state, attachment download, reply/forward composition. | Present |

`login-form` is a required authentication dependency but outside the requested CRM/outreach product scope. `settings-tabs` contains one included mailbox tab and one excluded staff tab. `staff-manager` is excluded.

## Server actions and source queries

### Server actions

| File | Exported operations | Scope |
| --- | --- | --- |
| `app/actions/contacts.ts` | `fetchContactsPage`, `fetchContactDetail` | Contact pagination/detail |
| `app/actions/companies.ts` | `fetchCompaniesPage`, `fetchCompanyDetail`, `updateCompany` | Company list/detail/update |
| `app/actions/leads.ts` | `assignLead`, `addFollower`, `removeFollower`, `setLeadTemperature`, `createLead`, `addLeadEmail`, `removeLeadEmail`, `addLeadPhone`, `removeLeadPhone`, `addLeadSocial`, `removeLeadSocial` | CRM |
| `app/actions/imports.ts` | `createImportJob`, `fetchImportJob`, `fetchActiveImportJob` | CSV import |
| `app/actions/mailboxes.ts` | `setDeliverabilityThreshold`, `setMailboxActive`, `fetchMailboxesPage` | Mailboxes/policies |
| `app/actions/sequences.ts` | `fetchSequences`, `fetchSequenceDetail`, `createSequence`, `updateSequence`, `setSequenceStatus`, `addSequenceStep`, `updateSequenceStep`, `deleteSequenceStep`, `reorderSequenceSteps`, `addStepVariant`, `updateStepVariant`, `deleteStepVariant`, `fetchLeadSequenceInfo`, `fetchActiveSequenceOptions`, `startLeadSequence`, `stopLeadSequence`, `resumeLeadSequence`, `fetchAccountOptions`, `reassignLeadRoute`, `fetchSendPolicy`, `saveSendPolicy` | Cold-email configuration/execution |
| `app/actions/inbox.ts` | `markConversationRead`, `fetchThread`, `fetchConversationsPage`, `createAttachmentDownloadUrl` | Inbox |
| `app/actions/compose.ts` | `sendConversationMessage` | Reply/forward submission |
| `app/actions/auth.ts` | `login`, `logout` | Cross-cutting auth, excluded from functional target |
| `app/actions/staff.ts` | `addStaffMember` | Workspace staff administration, excluded |

### Query adapters

| File | Exported queries | Scope |
| --- | --- | --- |
| `lib/queries.ts` | `getViewer`, `getMailboxRows`, `getConversations`, `getContactRows`, `getContactDetail`, `getWorkspaceMembers`, `getStaffMembers`, `getDeliverabilityThreshold`, `getLeadInbox`, `getThread`, `getCompanyRows`, `getCompanyDetail` | CRM, mailboxes, inbox and cross-cutting workspace data |
| `lib/sequence-queries.ts` | `getSequenceActivity`, `getSequences`, `getSequenceDetail`, `getSendPolicy`, `getLeadSequenceInfo` | Sequence configuration, send policy, routing/execution state and metrics |
| `lib/bulk-import-store.ts` | Client-side import job state, Storage upload, Edge Function invocation, polling/retry | CSV import |

## Database contracts used by the source

The source performs direct reads/writes against the following database relations. None has DDL or policy implementation in the source repository.

| Relation | Kind | Used for |
| --- | --- | --- |
| `leads` | table | Lead identity, company, status, reply temperature, DNC, contact details and conversation joins |
| `lead_companies` | table | Company creation, update and lead association |
| `lead_email_addresses` | table | Lead email methods and primary address |
| `email_addresses` | table | Shared normalized email and validation state |
| `lead_phone_numbers` | table | Lead phone methods |
| `lead_social_media` | table | Social contact methods |
| `lead_assignees` | table | Single current lead owner |
| `lead_followers` | table | Additional lead watchers |
| `lead_import_jobs` | table | CSV job metadata, mapping, progress and totals |
| `lead_directory` | view | Sorted/filterable contact directory and activity metadata |
| `company_directory` | view | Sorted/filterable company directory and aggregate lead/activity data |
| `workspace_members` | table | Active membership, role and workspace resolution |
| `profiles` | table | User display names and email addresses |
| `workspaces` | table | Workspace deliverability threshold |
| `email_accounts` | table | Mailboxes, provider identifier/type, enabled flag, Warmy fields |
| `email_account_send_policies` | table | Daily caps, ramping, pause and health threshold settings |
| `email_account_send_usage` | table | Per-local-day reserved/sent counts |
| `sequences` | table | Sequence metadata/status/version/timezone |
| `sequence_steps` | table | Ordered scheduling settings per step |
| `sequence_step_variants` | table | A/B subject/body templates |
| `sequence_daily_stats` | view | Time-series send/reply/cancel/failure/bounce chart |
| `sequence_stats` | view | Per-sequence state/send aggregates |
| `sequence_step_stats` | view | Per-step state/send aggregates |
| `sequence_variant_stats` | view | Per-variant sent aggregate |
| `lead_email_routes` | table | Persisted lead-to-mailbox route |
| `lead_sequence_states` | table | Current/recent lead execution state and stop/block reasons |
| `sequence_send_attempts` | table | Scheduled/submitted/sent/failed/cancelled/bounced history |
| `conversations` | table | Thread identity, linked lead, provider thread, inbound visibility, last activity |
| `email_messages` | table | Inbound/outbound messages, content, recipients, read state and provider message IDs |
| `email_attachments` | table | Attachment metadata and Storage object path |

### Directly invoked RPCs

These functions are called by source code; their bodies, grants, validation and transactions are not present.

| RPC | Calling source | Intended contract |
| --- | --- | --- |
| `find_or_create_email_address(p_email)` | `actions/leads.ts` | Reuse/create a shared email-address row and return its ID. |
| `search_lead_ids(p_query, p_max)` | `lib/queries.ts` | RLS-aware indexed contact search. |
| `search_company_ids(p_query, p_max)` | `lib/queries.ts` | RLS-aware indexed company search. |
| `set_deliverability_threshold(p_threshold)` | `actions/mailboxes.ts` | Set/clear workspace threshold and immediately apply mailbox activation. |
| `set_sequence_status(p_sequence_id, p_status)` | `actions/sequences.ts` | Validate and transition a sequence status. |
| `reorder_sequence_steps(p_sequence_id, p_step_ids)` | `actions/sequences.ts` | Atomically validate/reorder steps. |
| `start_lead_sequence(p_lead_id, p_sequence_id)` | `actions/sequences.ts` | Create/activate lead execution and schedule its first work. |
| `stop_lead_sequence(p_lead_id, p_reason?)` | `actions/sequences.ts` | Stop execution and cancel eligible work. |
| `resume_lead_sequence(p_state_id)` | `actions/sequences.ts` | Resume a blocked execution. |
| `reassign_lead_email_route(p_lead_id, p_email_account_id)` | `actions/sequences.ts` | Validate/record a route replacement. |

### Storage buckets and Edge Functions

| Resource | Calling source | Purpose | Status |
| --- | --- | --- | --- |
| Storage bucket `lead-imports` | `lib/bulk-import-store.ts` | Browser uploads `${workspaceId}/${jobId}.csv`; the job table stores the path. | Remote configuration/policy only |
| Storage bucket `email_attachments` | `actions/inbox.ts` | Create a 120-second signed download URL for an attachment path after stripping the `email_attachments/` prefix. | Remote configuration/policy only |
| Edge Function `process-lead-import` | `lib/bulk-import-store.ts` | Start/restart background processing for `{ jobId }`; job polling assumes resumability from `processed_rows`. | Invocation only; source absent |
| Edge Function `send-message` | `actions/compose.ts` | Authorize a mailbox with caller JWT, submit reply/forward to EmailEngine, record outbound message/conversation linkage. | Invocation only; source absent |
| Edge Function `create-staff-member` | `actions/staff.ts` | Privileged auth user creation and workspace membership insertion. | Invocation only; excluded from target scope |

## Generated-types-only declarations

The following declarations appear in `lib/database.types.ts` yet are not called or queried by the source application. They may describe planned or separately deployed backend behavior; they are not evidence of checked-in implementation.

| Declaration | Category | Relevance |
| --- | --- | --- |
| `lead_email_route_events` | table | Likely route audit history; relevant to outreach but unused by UI/query code. |
| `sequence_sandbox_messages` | table | Likely non-production/test sequence deliveries; not used. |
| `workspace_invitations` | table | Staff/onboarding feature; excluded. |
| `apply_warmy_health` | RPC | Health ingestion; outreach-relevant but types only. |
| `claim_sequence_dispatch`, `complete_sequence_dispatch`, `fail_sequence_dispatch`, `sequence_queue_read` | RPCs | Queue/dispatcher protocol; outreach-relevant but types only. |
| `get_sequence_queue_metrics`, `process_lead_import_rows` | RPCs | Queue/import worker helpers; relevant but types only. |
| `lead_display_name`, `show_limit`, `show_trgm` | RPCs | Utility/extension functions; no application call. |

## Explicit exclusions

- Workspace staff lifecycle, invitations, role mutation, user creation, password lifecycle, and authentication UX are not part of the requested CRM/outreach scope. A minimal independently implemented auth/workspace foundation will still be required before protected CRM data can be used.
- Visual branding assets, theme selection, generic UI primitives, mobile styling, Next configuration, linting and CSS are implementation references only.
- No prospects/enrichment, campaigns other than the defined sequences, calls, task management, analytics beyond the source sequence/mailbox metrics, billing, or external-source data synchronization is in scope.
- There is no source implementation of backend jobs or integrations to copy. Any future backend must be newly designed and owned by this project.
