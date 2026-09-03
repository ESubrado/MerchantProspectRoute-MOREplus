# Durable CSV contact imports

Phase 4 is an independently owned contact-import capability. It does not use the reference application's Storage bucket, worker, database, package, credentials, or deployed services.

## Current release state

The Contacts page deliberately renders a disabled **Import CSV** button with an **Imports coming soon** explanation. The visible button is not the enforcement boundary:

- Every creation command checks the signed-in user's active `workspace_members` role and requires owner or admin.
- `workspace_import_settings.imports_enabled` defaults to `false`; a missing settings row also means disabled.
- The database rejects job creation while disabled, so calling a server action or RPC outside the UI cannot bypass the staged release.

Do not set `imports_enabled` to `true` until the migration, private bucket, worker deployment, scheduler, cleanup job, and operator alerting are all live. The UI remains intentionally disabled in this release even after infrastructure is deployed.

## File contract

- CSV only: `text/csv`, `application/csv`, or `application/vnd.ms-excel`.
- Maximum source size: **10 MiB**.
- UTF-8 encoding, comma separator, RFC 4180 quoting, one header row, and at least one non-empty data row.
- At most 100 columns. Each mapped field may appear once; `ignore` may appear repeatedly.

Supported column mappings are `first_name`, `last_name`, `full_name`, `email`, `phone`, `company`, `company_website`, `linkedin`, and `ignore`. At least one name field or email must be mapped.

The future browser dialog receives only a short-lived signed-upload token scoped to a single private object path. It uploads bytes to `contact-imports`; it never receives the service-role credential, reads the source object, parses the full CSV, writes CRM records, or retries a stalled job.

## Identity and duplicate rules

The worker trims whitespace and normalizes emails to lowercase.

1. A row with a normalized email is skipped when that email is already linked to any contact in the same workspace, including a row committed by an earlier batch of the same job.
2. A row without an email is skipped when its normalized full name and resolved company are already present in the workspace. A missing company is treated as a real value in this comparison, so two independent contacts with the same name are considered duplicates.
3. An email-only row is permitted and uses the email as the contact's `full_name` display fallback. Missing or invalid identity data is an invalid-row error.
4. Companies resolve by normalized website domain first, then normalized company name. A missing company name with a valid website uses the website domain as the company name. Existing company fields are not overwritten by imports.
5. Phones must be E.164. An invalid phone is dropped as a warning while the contact can still import. Invalid company websites and LinkedIn URLs are likewise warnings when the rest of the row is valid.

The import stores row number, severity, code, and message only. It does not retain raw CSV cell values in the database.

## Durable job lifecycle

`contact_import_jobs` stores the file metadata, mapping, progress counters, lease, terminal error, and retention deadline. The worker takes a five-minute lease with `FOR UPDATE SKIP LOCKED`; an expired `processing` lease is claimable by another worker. Each 200-row database batch updates rows, counters, errors, and persisted progress in one transaction. A worker crash before commit replays that batch, and the duplicate rules make that replay safe.

The state flow is:

```text
awaiting_upload -> processing -> done
                  processing -> failed
stale processing -> processing (reclaimed with a new lease)
failed -> awaiting_upload (explicit retained-job retry)
```

A worker checks waiting jobs for their private object. A browser closing after upload cannot strand processing: later worker runs continue to discover the object. The browser may poll the bounded job snapshot but has no retry responsibility. Job creation, completion, failure, cancellation, and retry requests write immutable audit events.

## Deployment and worker runbook

1. Apply all migrations in lexical order, including `20260903000900_phase_4_durable_contact_imports.sql`, as the database owner.
2. Confirm that the private `contact-imports` bucket exists and remains non-public. Do not add direct authenticated Storage policies for it.
3. Set these secrets only in the Next.js server and worker runtime; never expose them to the browser:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=server-and-worker-only-service-role-key
   # Optional stable worker instance label for logs
   CONTACT_IMPORT_WORKER_ID=imports-worker-1
   ```

4. Run one worker claim from a durable scheduler at least once per minute. The command processes one claimed job and exits, which is suitable for cron, a platform scheduled task, or a queue consumer wrapper:

   ```powershell
   npm run imports:worker
   ```

   For a long-lived development or worker process, use `npm run imports:worker:watch`. The worker needs a Node runtime and graceful restarts; serverless request lifetimes are not a substitute for a durable worker.

5. Schedule retention cleanup daily:

   ```powershell
   npm run imports:cleanup
   ```

6. Observe failed jobs, repeated lease reclamation, missing uploads, and cleanup failures. Alert before enabling the feature for users.
7. Only after those checks, a database owner may enable an individual workspace. This should remain off while the Import CSV UI is intentionally disabled:

   ```sql
   insert into public.workspace_import_settings (workspace_id, imports_enabled)
   values ('replace-with-workspace-uuid', true)
   on conflict (workspace_id) do update set imports_enabled = excluded.imports_enabled;
   ```

## Retention and recovery

Source CSV objects are private and retained for 30 days after job creation. `npm run imports:cleanup` removes only terminal `done` or `failed` source objects whose deadline has elapsed, then records `source_deleted_at`. A failed job can be retried only while its retained source exists. Do not manually delete a source object until its job is terminal; doing so leaves an `awaiting_upload` job for the worker to discover later.

`npm run imports:worker` is safe to run concurrently. The database claim and lease prevent two workers from processing the same active job. A failed job records a diagnosable terminal error; a future authorized retry action queues it for worker pickup without re-uploading or browser-side replay.
