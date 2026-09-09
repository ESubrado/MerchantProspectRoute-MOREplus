# Phase 7A outbound scaffolding

## Release status

Phase 7A is a non-operational foundation for reliable outbound routing and sequence dispatch. It is deliberately **disabled in code** and cannot submit email, claim a job, connect to a queue, access object storage, call a provider, or accept a provider webhook.

Adding credentials to a deployment cannot activate delivery. A later reviewed Phase 7 release must change the literal safety boundary in `lib/outbound/phase-7a.ts`, add the missing migration and worker implementation, and pass the checklist below.

## What is present

- `lib/outbound/phase-7a.ts` provides one server-only fail-closed guard and a safe readiness DTO.
- `lib/outbound/provider-adapter.ts` defines the target-owned, provider-neutral adapter contract. Its only implementation throws before performing any work.
- `lib/outbound/worker.ts` is a side-effect-free worker entry-point placeholder. It reports zero claimed jobs.
- `GET /api/outbound/status` reports that Phase 7A is disabled. It is not a deployment-health endpoint and exposes no configuration values.
- `POST /api/outbound/webhook` responds with `503` before reading the request body. It must not be registered with an email provider yet.

## What is intentionally absent

- No Phase 7 database migration, route, enrollment, send-attempt, event, outbox, queue, dead-letter, or webhook-event records.
- No provider SDK, provider account, provider credentials, fetch call, webhook parser, or provider-specific code.
- No worker process script, queue connection, scheduler, storage access, or deployment task.
- No browser action, Route Handler, page render, or server action that can submit a send.

## Completion checklist before enabling delivery

1. Select and record the project-owned provider, queue/worker host, and object storage service. Keep all credentials server/worker-only.
2. Approve the executable-sequence model: ordered steps, delays, schedule timezone/window behavior, deterministic jitter, and the transition rules for `active`, resumable `blocked`, terminal stop reasons, cancellation, and completion.
3. Verify the provider supports stable idempotency keys, submission IDs, signed retried webhooks, bounce/reply events, rate-limit feedback, and timeout reconciliation.
4. Add a forward-only Phase 7 migration. It must preserve dormant Phase 5/6 enrollment records, use campaign-scoped worker commands, and create immutable route, state, send-attempt, and provider-event facts.
5. Implement one target-owned provider adapter. Persist the target attempt ID as the idempotency key, and persist the provider submission ID before marking an attempt submitted.
6. Implement a worker outside browser/page rendering. It must lease jobs, recheck DNC/reply/bounce/cancellation immediately before submission, reserve daily capacity atomically, and use deterministic retry/dead-letter handling.
7. Replace the webhook rejection only after raw-body signature verification, durable provider-event deduplication, and a quick `2xx` acknowledgement are tested.
8. Run disposable-database integration tests for duplicate execution, DNC, daily-cap races, stop/resume, provider retries/timeouts, webhook replay, and tenant/campaign isolation.
9. Review the deployment runbook, retention policy, alerts, dead-letter recovery procedure, and provider acceptable-use/compliance requirements before enabling any mailbox.

## Environment guidance

The sample environment file names future server/worker values but they are not read by Phase 7A. Do not add an `OUTBOUND_DELIVERY_ENABLED` flag: the scaffold intentionally has no configuration-only activation path. Keep `SUPABASE_SERVICE_ROLE_KEY`, provider keys, webhook secrets, queue URLs, and object-store keys out of browser code and out of version control.
