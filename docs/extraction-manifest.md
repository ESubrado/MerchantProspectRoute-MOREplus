# Extraction manifest

## Purpose and guardrails

This is a reference manifest, not a copy plan. It records what was inspected in `C:\GitRepositories\Merchant-outbound-routing-engine` at revision `af98b0aade26394a80395b1ff81c29d22a375fd9` and how it may inform a new, standalone implementation.

- SOURCE remains read-only and will not be modified.
- No source file will be imported at runtime or build time.
- No symlink, file reference, package linkage, environment variable, database, Storage bucket, Edge Function or credential from SOURCE will be used by the target.
- The initial standalone scaffold contains only App Router placeholders, shared UI primitives, and a preview workspace shell; it does not connect a source or production backend.
- The manifest distinguishes behavioral reference material from missing remote backend contracts.

## Route and UX reference manifest

| Source artifact | Reference value | Target treatment | Extraction status |
| --- | --- | --- | --- |
| `app/(inbox)/layout.tsx`, `proxy.ts`, `app/login/page.tsx`, `components/login-form.tsx` | Protected layout, session refresh/redirect and password login presentation. | Build a standalone auth/workspace boundary later; do not import Supabase helpers or copy credentials. | Reference only |
| `app/(inbox)/contacts/page.tsx`, `components/contacts-table.tsx` | Contact directory layout, pagination, server search/sort/filter UX. | Reimplement against target query API and tenant-safe search. | Reference only |
| `components/contact-drawer.tsx`, `components/add-lead-drawer.tsx`, `components/lead-link.tsx`, `components/lead-temperature.tsx`, `components/temperature-picker.tsx`, `components/social-platform-icon.tsx` | Contact detail/create and contact-method/ownership/temperature interactions. | Recreate needed UX after CRM commands and DTOs exist. | Reference only |
| `app/(inbox)/companies/page.tsx`, `components/companies-table.tsx`, `components/company-drawer.tsx`, `components/company-link.tsx` | Company directory/detail/edit behavior. | Reimplement against the target company domain. | Reference only |
| `components/bulk-import-dialog.tsx`, `components/import-status-pill.tsx`, `lib/bulk-import-store.ts`, `app/actions/imports.ts` | CSV mapping, upload/progress/re-adoption UX and source job fields. | Recreate only after independently owned object storage/job worker exists. | Reference only; backend absent |
| `app/(inbox)/mailboxes/page.tsx`, `components/mailboxes-table.tsx`, `components/mailbox-drawer.tsx`, `components/mailbox-settings.tsx`, `components/email-provider-icon.tsx`, `app/actions/mailboxes.ts` | Mailbox list, health display, enable flag, health threshold and policy UX. | Reimplement when mailbox/provider domain is selected. | Reference only; health backend absent |
| `app/(inbox)/sequences/page.tsx`, `components/create-first-sequence.tsx`, `components/sequence-editor.tsx`, `components/sequence-activity-chart.tsx`, `app/actions/sequences.ts`, `lib/sequence-queries.ts` | Sequence/step/variant editing, status controls, policy and metrics presentation. | Rebuild on a target sequence state machine and scheduler. | Reference only; dispatch backend absent |
| `app/(inbox)/lead/[leadId]/page.tsx`, `components/lead-sequence-panel.tsx` | Lead-level route, execution state and attempt-history UI. | Rebuild after target enrollment/attempt services exist. | Reference only; execution backend absent |
| `app/(inbox)/page.tsx`, `app/(inbox)/c/[conversationId]/page.tsx`, `components/app-sidebar.tsx`, `components/lead-conversations.tsx`, `components/thread-messages.tsx`, `components/mark-read.tsx`, `components/message-composer.tsx`, `components/attachment-chip.tsx`, `app/actions/inbox.ts`, `app/actions/compose.ts` | Inbox, thread, reply/forward, attachment and filtering behavior. | Rebuild against target provider ingress, message store and object-store authorization. | Reference only; provider backend absent |

## Domain/data contract manifest

| Target capability | Source relation/contract reference | Availability in SOURCE | Target action |
| --- | --- | --- | --- |
| Workspace/access | `workspaces`, `workspace_members`, `profiles`; source `getViewer` | Query/type usage only; no schema/RLS | Design standalone identity, workspace membership and authorization. |
| Contacts and contact methods | `leads`, `lead_email_addresses`, `email_addresses`, `lead_phone_numbers`, `lead_social_media`, `lead_assignees`, `lead_followers`, `lead_directory` | Query/action/type usage only | Create owned CRM model, constraints and projections. |
| Companies | `lead_companies`, `company_directory`, `search_company_ids` | Query/action/RPC invocation/type usage | Create owned company model and tenant-safe search. |
| DNC/temperature | `leads.reply_temperature`, `leads.email_dnc` | UI/action usage; auto behavior only in comments | Define compliance and automatic-classification policy. |
| CSV jobs | `lead_import_jobs`, bucket `lead-imports`, `process-lead-import`, `process_lead_import_rows` | Table/action/storage invocation; worker/RPC types only | Build independently owned upload and durable import worker. |
| Mailboxes | `email_accounts`, `workspaces.deliverability_threshold`, `set_deliverability_threshold`, `apply_warmy_health` | Query/action/RPC invocation; health RPC types only | Select provider/health source and create owned mailbox model. |
| Send policies | `email_account_send_policies`, `email_account_send_usage` | Query/action/type usage only | Implement policy/default/ramp and atomic usage reservation. |
| Sequence definition | `sequences`, `sequence_steps`, `sequence_step_variants`, sequence stats views, `set_sequence_status`, `reorder_sequence_steps` | Query/action/type/RPC invocation | Implement config model and derived stats. |
| Route/execution | `lead_email_routes`, `lead_email_route_events`, `lead_sequence_states`, `sequence_send_attempts`, route/lifecycle RPCs | Query/action/RPC invocation; route events types only | Implement state machines, route audit and queue-owned delivery. |
| Inbox/replies | `conversations`, `email_messages`, `email_attachments`, bucket `email_attachments`, `send-message` | Query/action/Storage/Edge invocation; ingress/function source absent | Implement provider adapter/webhooks, message persistence, sanitized rendering and signed downloads. |

## Remote backend contract manifest

| Contract | Source evidence | Classification | Target disposition |
| --- | --- | --- | --- |
| `find_or_create_email_address` | Direct RPC in `actions/leads.ts` | Invoked, implementation absent | Replace with target canonical-email transaction/service. |
| `search_lead_ids`, `search_company_ids` | Direct RPCs in `lib/queries.ts` | Invoked, implementation absent | Replace with target scoped-search query/index design. |
| `set_deliverability_threshold` | Direct RPC in `actions/mailboxes.ts` | Invoked, implementation absent | Replace with target policy reconciliation command. |
| `set_sequence_status`, `reorder_sequence_steps` | Direct RPCs in `actions/sequences.ts` | Invoked, implementation absent | Replace with target validated transactional commands. |
| `start_lead_sequence`, `stop_lead_sequence`, `resume_lead_sequence`, `reassign_lead_email_route` | Direct RPCs in `actions/sequences.ts` | Invoked, implementation absent | Replace with target execution/routing services. |
| `process-lead-import` | Edge invocation in `lib/bulk-import-store.ts` | Invoked, implementation absent | Replace with project-owned job worker entrypoint. |
| `send-message` | Edge invocation in `actions/compose.ts` | Invoked, implementation absent | Replace with project-owned outbound-message service/provider adapter. |
| `apply_warmy_health`, queue/dispatch and import helper RPCs | `lib/database.types.ts` only | Generated types only | Do not assume implementation; adopt only after target design requires an equivalent. |
| `create-staff-member` | Edge invocation in `actions/staff.ts` | Invoked, implementation absent and excluded | Do not extract; introduce minimal standalone workspace bootstrapping only if needed. |

## Source artifacts intentionally not extracted

| Artifact category | Examples | Reason |
| --- | --- | --- |
| Source backend identity/dependencies | `lib/supabase/*`, `proxy.ts` environment names, generated `database.types.ts` | Would create forbidden runtime/environment/database dependency on SOURCE and lacks actual implementation. |
| Unrelated feature scope | `components/staff-manager.tsx`, staff action, `workspace_invitations` types | Staff lifecycle is not part of the requested target. |
| Generic presentation infrastructure | `components/ui/*`, theme provider, CSS, logo/assets | No need to copy before target design; these are not the requested product extraction. |
| Speculative generated contracts | `sequence_sandbox_messages`, `lead_email_route_events`, extension helper RPCs | Types only or unused; absence of source behavior makes their purpose uncertain. |
| Repository/tooling configuration | `package.json`, `next.config.ts`, lint/style config | Target project setup has not been requested; Next.js documentation must be read before application code. |

## Authorized source-asset exception

After this manifest was written, the user explicitly authorized copying the SurnMore logo. `SOURCE/public/Surnmore Logo.svg` is therefore copied into this target as `public/surnmore-logo.svg`. It is a local target asset: the application does not import, link to, or otherwise depend on the SOURCE repository at runtime or build time. No other source branding, layout, styling, assets, or code were adopted.

## Verification record

- Inspected all source page routes under `app/`, all server actions under `app/actions/`, query adapters (`lib/queries.ts`, `lib/sequence-queries.ts`), client import orchestration (`lib/bulk-import-store.ts`), custom components and generated database types.
- Searched source code for direct database table access, RPC calls, Storage bucket access and Edge Function invocation.
- Confirmed no migrations, `supabase/functions` directory, route-handler API layer, queue worker, cron configuration or provider-integration implementation exists in the source file inventory.
- The documentation phase created the four requested Markdown documents. The subsequent, separately authorized scaffold adds only standalone UI and configuration foundations.

## Readiness gate

The standalone application scaffold is now initialized. Backend implementation remains gated by the decisions in [backend-gap-register.md](backend-gap-register.md); the scaffold intentionally contains no database, Storage, queue, mailbox-provider, or authentication integration. The installed Next.js documentation was consulted before this Next.js code was written, as required by this repository's `AGENTS.md`.
