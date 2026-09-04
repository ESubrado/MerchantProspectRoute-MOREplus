import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../migrations/20260903000400_phase_4_durable_contact_imports.sql", import.meta.url), "utf8");
const importData = await readFile(new URL("../../lib/imports/contact-imports.ts", import.meta.url), "utf8");
const importContract = await readFile(new URL("../../lib/imports/contract.ts", import.meta.url), "utf8");
const importActions = await readFile(new URL("../../app/actions/imports.ts", import.meta.url), "utf8");
const contactsScreen = await readFile(new URL("../../components/screens/contacts-screen.tsx", import.meta.url), "utf8");
const worker = await readFile(new URL("../../scripts/contact-import-worker.mjs", import.meta.url), "utf8");
const cleanup = await readFile(new URL("../../scripts/contact-import-cleanup.mjs", import.meta.url), "utf8");
const runbook = await readFile(new URL("../../docs/contact-import-runbook.md", import.meta.url), "utf8");

test("Phase 4 persists import state, row outcomes, and a private disabled-by-default storage boundary", () => {
  assert.match(migration, /create table public\.workspace_import_settings/i);
  assert.match(migration, /imports_enabled boolean not null default false/i);
  assert.match(migration, /create table public\.contact_import_jobs/i);
  assert.match(migration, /create table public\.contact_import_row_errors/i);
  assert.match(migration, /'contact-imports'/i);
  assert.match(migration, /false,\s*10485760/i);
  assert.match(migration, /source_delete_after timestamptz not null default \(now\(\) \+ interval '30 days'\)/i);
  assert.match(migration, /contact_import_jobs_one_active_per_workspace_key/i);
  assert.match(migration, /alter table public\.contact_import_jobs enable row level security/i);
});

test("Phase 4 commands enforce workspace authorization, worker leases, batch progress, and audit facts", () => {
  for (const command of [
    "crm_create_contact_import_job",
    "crm_get_contact_import_job",
    "crm_retry_contact_import_job",
    "crm_claim_contact_import_job",
    "crm_process_contact_import_batch",
    "crm_get_contact_import_worker_state",
    "crm_complete_contact_import_job",
    "crm_list_expired_contact_import_sources",
  ]) {
    assert.match(migration, new RegExp(`create function public\\.${command}`, "i"));
  }

  assert.match(migration, /crm_assert_contact_import_manager/i);
  assert.match(migration, /CSV imports are not enabled for this workspace/i);
  assert.match(migration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /jsonb_array_length\(p_rows\) not between 1 and 200/i);
  assert.match(migration, /'contact_import\.created'/i);
  assert.match(migration, /'contact_import\.completed'/i);
  assert.match(migration, /'contact_import\.failed'/i);
});

test("Phase 4 keeps browser import preparation narrow and leaves processing, retry, and cleanup to server workers", () => {
  assert.match(importData, /getAuthorizedWorkspaceAccess/);
  assert.match(importData, /isWorkspaceManagerRole\(workspaceAccess\.role\)/);
  assert.match(importData, /createSignedUploadUrl/);
  assert.match(importActions, /createContactImportUploadAction/);
  assert.match(importContract, /CONTACT_IMPORTS_COMING_SOON_MESSAGE/);
  assert.match(contactsScreen, /Import CSV/);
  assert.match(contactsScreen, /Imports coming soon/);
  assert.match(contactsScreen, /disabled variant="secondary"/);
  assert.match(worker, /crm_claim_contact_import_job/);
  assert.match(worker, /crm_process_contact_import_batch/);
  assert.match(worker, /crm_get_contact_import_worker_state/);
  assert.match(worker, /crm_complete_contact_import_job/);
  assert.match(worker, /processed_rows/);
  assert.match(cleanup, /crm_list_expired_contact_import_sources/);
  assert.match(runbook, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(runbook, /10 MiB/);
  assert.match(runbook, /Duplicate rules/i);
});
