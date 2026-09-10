# Supabase Cron outbound-dispatch ingress

## Current release status

`supabase/functions/outbound-dispatch/index.ts` is a source-only, non-operational Supabase Edge Function. It accepts only `POST`, verifies the `x-outbound-cron-secret` header against `OUTBOUND_CRON_SCHEDULER_SECRET`, and then returns `503` without reading the request body.

It cannot read PGMQ, call an RPC, access object storage, invoke a provider, or send email. There is no deployed function, enabled extension, Cron job, queue, migration, provider account, or provider webhook in this release.

`verify_jwt = false` is deliberate: Supabase Cron is not a browser or user-session caller. The endpoint's only accepted caller identity is the random scheduler secret, which must be present both as a Supabase Function secret and as a Supabase Vault secret. It is never an application `NEXT_PUBLIC_` environment variable or a committed value.

## Future Phase 7 deployment sequence

Do not perform these steps until every Phase 7 completion requirement in [`phase-7a-outbound-scaffolding.md`](./phase-7a-outbound-scaffolding.md) has been met.

1. Apply the reviewed forward-only Phase 7 migration as the database owner. It will introduce the project-owned attempt/event state, worker-only commands, PGMQ queue, and bounded scheduler/recovery functions.
2. Enable `pgmq`, `pg_cron`, and `pg_net` only through that reviewed migration or the Supabase dashboard, using the project-owned Supabase instance.
3. Generate one high-entropy scheduler secret. Set it as `OUTBOUND_CRON_SCHEDULER_SECRET` in Supabase Edge Function secrets and store the identical value in Supabase Vault under a migration-documented name. Do not copy the secret into this repository or the Next.js runtime.
4. Deploy the reviewed function with `supabase functions deploy outbound-dispatch`. The current function must not be deployed as an active scheduler because it intentionally responds with `503`.
5. After the provider adapter and disposable-database integration suite pass, create the reviewed `pg_cron` jobs. The scheduler job may materialize due attempts; the dispatch trigger may invoke this function with the Vault-backed secret; the recovery job may reclaim expired leases. Each job must be bounded and observable.
6. Verify Cron run history, function logs, queue depth, lease recovery, dead-letter alerts, and a no-mail smoke test before enabling any mailbox. Run the approved provider and webhook tests before allowing a real send.

## Cron job command

The SQL Editor command that creates the job is in [`supabase/cron/outbound-dispatch.sql.example`](../supabase/cron/outbound-dispatch.sql.example). The Dashboard form's job body is in [`supabase/cron/outbound-dispatch-command.sql.example`](../supabase/cron/outbound-dispatch-command.sql.example). Both are deliberately operator-run templates rather than migrations: Function URLs and the scheduler secret belong in Supabase Vault, not in source control. The job starts at one tick per minute, sends only a timestamp to the dispatcher, and keeps the secret in the `x-outbound-cron-secret` header.

Do not run that template while this release's `outbound-dispatch` Function returns `503`. A Cron call would be harmless but would create continuous expected failures and conceal a real operational fault.

### Dashboard procedure after Phase 7 is approved

1. In the Supabase project, open **Integrations** → **Cron** and enable the Cron Postgres Module (`pg_cron`) if it is not already enabled.
2. Confirm the reviewed Phase 7 migration enabled `pg_net` and PGMQ, the real dispatcher is deployed, and its Function secret `OUTBOUND_CRON_SCHEDULER_SECRET` has the same high-entropy value stored in Vault as `outbound_cron_scheduler_secret`.
3. In **Integrations** → **Vault**, create `outbound_cron_dispatch_url` with the exact deployed Edge Function URL and create or confirm `outbound_cron_scheduler_secret`. Do not copy either value into the Next.js environment or repository.
4. Return to **Integrations** → **Cron** → **Jobs** and choose **Create job**. Use the exact name `outbound-dispatch`; Cron job names are case-sensitive.
5. Select a one-minute schedule (`* * * * *`) for the initial rollout. Use an **SQL snippet** job, not the simplified Edge Function selector, so the Vault-backed custom scheduler header is supplied.
6. Paste only the contents of `outbound-dispatch-command.sql.example` as the SQL snippet and create the job. The Dashboard supplies the name and schedule. Alternatively, use the SQL Editor and run `outbound-dispatch.sql.example`, which creates the same job with `cron.schedule`.
7. Run the final verification queries in `outbound-dispatch.sql.example` from the SQL Editor.
8. Watch the job's **History**, Edge Function logs, and queue/lease metrics. If anything is unexpected, remove the job with the exact named `cron.unschedule` command in the template before investigating.

## Required future observability

Alert on repeated unauthorized scheduler calls, Cron failures, queue depth growth, expired leases, dead letters, capacity rejections, provider failures, and duplicate provider-event attempts. Keep queue messages to opaque project-owned attempt IDs; the database remains the source of truth for recipient data and send state.
