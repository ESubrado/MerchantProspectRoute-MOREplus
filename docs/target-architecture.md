# Target architecture

## Decision

Build a standalone Next.js application with an independently owned backend. The source repository is a behavioral reference only; this target will neither import nor connect to it. The exact Next.js version and conventions will be verified against this repository's installed Next.js documentation before application code is written.

The target should preserve the scoped user experience while making asynchronous email/import processing explicit. The source collapses UI, database contracts, and remote workers into one Supabase-facing application; the target separates them so all product-critical behavior is implementable, testable, and deployable from this repository.

## Logical design

```text
Browser
  |
  v
Next.js routes + server actions / route handlers
  |-- CRM module ------------------------------> application database
  |-- Outreach configuration module -----------> application database
  |-- Inbox/read-reply module -----------------> application database + object storage
  |-- Import command --------------------------> object storage + durable job queue
  `-- Provider/webhook adapters <--------------> email provider / mailbox service

Durable workers
  |-- CSV import worker -----------------------> CRM tables + import job updates
  |-- Sequence scheduler/dispatcher -----------> provider adapter + send attempts
  |-- Provider event/webhook processor --------> messages, conversations, state transitions
  `-- Mailbox-health synchronizer -------------> mailbox health / activation policy
```

The database is the system of record. The provider adapter and object store are dependencies of this new project, configured only through its own deployment configuration. Background work must be durable and idempotent; no browser request is responsible for completing an import or sending a scheduled sequence step.

## Product modules and route ownership

| Module | Target pages | Server responsibility |
| --- | --- | --- |
| Workspace access | Login plus protected application layout | Authenticate user, resolve active workspace, authorize roles. This is supporting infrastructure, not an expansion of source staff management. |
| Contacts | `/contacts`, contact drawer/deep link | Search/list contacts; create; manage methods; set temperature/DNC; assignment/followers; linked conversations and sequence execution. |
| Companies | `/companies`, company drawer/deep link | Search/list companies; edit core company fields; show linked contacts. |
| Imports | Contact-page dialog/status | Create job, issue scoped upload authorization, enqueue work, expose read-only job progress. |
| Mailboxes | `/mailboxes`, mailbox detail/settings | List state/health; enable/disable; configure send policy and workspace health threshold. Provisioning is a separate capability, initially out of UI scope. |
| Sequences | `/sequences` | Manage sequences, ordered steps, template variants and schedules; display derived metrics. Support many sequences in the domain even if the first UI presents one current sequence. |
| Lead execution | Lead detail/inbox panel | Start, stop, resume, and manually reassign a route; return route/state/history. Workers own automatic state transitions. |
| Inbox | `/`, `/c/[conversationId]`, `/lead/[leadId]` | List conversations, retrieve/mark messages read, issue attachment downloads, submit reply/forward commands. |

## Data model

Use UUID primary keys, workspace ownership on every tenant-owned record, UTC timestamps, immutable event/history records where applicable, and a transaction boundary for each command. The names below are target concepts, not an instruction to reuse the source schema verbatim.

```text
Workspace 1---* Member *---1 User
Workspace 1---* Company 1---* Lead
Lead 1---* LeadEmail ---1 CanonicalEmail
Lead 1---* LeadPhone
Lead 1---* LeadSocial
Lead 1---0..1 LeadAssignment
Lead 1---* LeadFollower

Workspace 1---* Mailbox 1---0..1 SendPolicy
Mailbox 1---* DailySendUsage
Lead 1---0..1 LeadMailboxRoute 1---* RouteEvent

Workspace 1---* Sequence 1---* SequenceStep 1---* StepVariant
Lead 1---* SequenceEnrollment 1---* SendAttempt
SendAttempt *---1 Mailbox

Mailbox 1---* Conversation 0..1---1 Lead
Conversation 1---* Message 1---* Attachment
Workspace 1---* ImportJob
```

### Required domain invariants

- A user can access only records in an active workspace membership. Admin-only commands include manual lead creation/import, mailbox configuration, sequence editing and execution controls.
- A lead belongs to one workspace and may belong to one company. Its contact methods are independently managed; canonical email validation belongs to the reusable canonical-email record.
- There is at most one current assignment per lead. Followers are unique per lead/user.
- Reply temperature is nullable or one of `0..4`; setting DNC (`3`) sets an explicit email DNC flag. Automated classification must be auditable and must not overwrite a manual decision without a deliberate policy.
- A lead has at most one current mailbox route. Reassignment writes an immutable route event with reason, actor and timestamp.
- A sequence has ordered, unique steps and each step has one or more variants. State-changing commands validate ownership, status and schedule before commit.
- Sequence enrollment and send attempts use explicit state machines; attempts must be idempotent against provider submission and webhook retries.
- A conversation is linked to a mailbox and optionally a lead. Inbox visibility follows the source rule: sequence-started threads become inbox-visible after an inbound message. Messages and attachments are immutable other than `is_read`/local read state.
- Object storage holds files only; metadata, ownership and access checks remain in the database. Downloads use short-lived, workspace-authorized URLs.

## Command/query boundaries

Queries are read-only and return projection DTOs tailored to the screen: contact/company directories, mailbox rows, sequence detail/statistics, lead execution detail, conversation list and thread. Searches must be tenant-scoped before full-text/trigram ranking is applied.

Commands make one business change and publish/enqueue work transactionally where required:

| Command group | Synchronous result | Asynchronous follow-up |
| --- | --- | --- |
| Lead/company/contact-method changes | Updated entity/projection or validation error | None, except optional validation/enrichment explicitly introduced later |
| Create CSV import | Job ID and scoped upload target | Import worker processes bytes, writes totals/status |
| Mailbox policy/status change | Updated policy/state | Optional health policy reconciliation |
| Sequence configuration | Updated configuration/version | Scheduler recomputes eligible work if an active sequence changed |
| Start/stop/resume/reassign lead execution | New state/route projection | Scheduler queues/cancels/re-evaluates attempts |
| Send reply/forward | Accepted command/attempt reference | Provider adapter sends and webhook/response writes durable message status |
| Provider inbound event | Idempotent acknowledgement | Persist message/conversation/attachment metadata; classify reply; stop/advance enrollment according to policy |

## Background processing

### CSV import worker

1. Claim a pending/resumable job with a lease.
2. Read the scoped CSV object, parse with the persisted column mapping, and process bounded batches.
3. Validate required identity, normalize contact methods, deduplicate in a documented workspace-safe way, find/create companies and canonical email records.
4. Commit batch results and counters atomically enough to safely resume. Mark `done` or record a diagnosable terminal error.

### Sequence scheduler and dispatcher

1. Find active enrollments whose next step is eligible in the step/sequence timezone.
2. Enforce lead DNC, bounce/reply terminal rules, mailbox active/health status, policy pause, daily cap, schedule window, throttle and jitter.
3. Select a route (persist it once) and an active variant; create a uniquely keyed send attempt before any provider call.
4. A dispatcher claims the attempt with a lease, sends through the project-owned provider adapter, and commits submitted/sent/failed/bounced/cancelled state idempotently.
5. Update enrollment state and next eligibility in the same command boundary. Derived stats are materialized or queried from indexed facts, not handwritten in the UI.

### Provider ingress and health

- Verify webhook signatures, retain provider IDs and deduplicate every event.
- Inbound mail writes messages/conversations/attachments, matches a lead conservatively, makes the thread inbox-visible, updates unread state, classifies reply temperature, and applies explicit stop/DNC rules.
- Outbound status/bounce events update the matching attempt and message. Provider callbacks are the authority for final delivery state.
- A mailbox-health adapter writes timestamped health observations. The workspace threshold is applied by a deterministic service, with an audit trail; it must never silently overwrite an explicit emergency pause.

## Security and operational requirements

- Keep provider credentials, service credentials and object-store signing keys server/worker-only. Never expose a service role or mailbox token to a browser.
- Enforce workspace authorization in every query, command, signed-upload/download path, worker claim and webhook-to-record match. Do not rely solely on page protection.
- Sanitize rendered email HTML; constrain outbound HTML/link generation; enforce recipient and attachment limits server-side.
- Record audit events for imports, route changes, policy changes, sequence state transitions and automated DNC/reply actions.
- Instrument job/worker lease failures, provider failures, webhook deduplication, send-cap rejection and stuck enrollment detection. Provide an operator-visible error state before adding automatic retries.

## Deliberate non-goals for the first standalone build

- Reusing the reference application's Supabase project, generated types, Edge Functions, buckets, keys, or database.
- Staff provisioning, invitations and role-management UI beyond the minimal protected-workspace mechanism required to run this scope.
- Mailbox connection/provisioning UI, email enrichment, call workflows, arbitrary campaign analytics, billing and unrelated product features.

## Build order after this discovery phase

1. Define and migrate the independently owned workspace/CRM schema and authorization model.
2. Implement CRM directories, detail views, contacts methods, assignment/followers, temperature/DNC, search and company editing.
3. Add object storage plus the durable CSV job/worker path.
4. Add mailbox/policy configuration and the sequence configuration domain.
5. Implement routing, enrollment state, scheduler/dispatcher, provider adapter and send history.
6. Implement provider ingress, inbox, attachments, reply/forward and automated reply outcomes.
7. Add audits, observability, recovery tools and end-to-end authorization/idempotency tests.
