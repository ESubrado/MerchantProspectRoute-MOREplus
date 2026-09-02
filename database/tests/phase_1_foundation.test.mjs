// These focused structural tests catch accidental removal of Phase 1 tables, RLS, or viewer authorization.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Migration paths step out of the tests directory, while the session path steps out of database.
const schema = await readFile(new URL("../migrations/20260903000100_phase_1_workspace_crm_schema.sql", import.meta.url), "utf8");
const rls = await readFile(new URL("../migrations/20260903000200_phase_1_workspace_crm_rls.sql", import.meta.url), "utf8");
const session = await readFile(new URL("../../lib/auth/session.ts", import.meta.url), "utf8");

// Keeping the table inventory explicit makes future schema scope changes intentional and reviewable.
const phaseOneTables = [
  "workspaces",
  "workspace_members",
  "companies",
  "leads",
  "canonical_email_addresses",
  "lead_email_addresses",
  "lead_phone_numbers",
  "lead_social_profiles",
  "lead_assignments",
  "lead_followers",
  "audit_events",
];

test("Phase 1 schema keeps every CRM record within a workspace", () => {
  for (const table of phaseOneTables) {
    assert.match(schema, new RegExp(`create table public\\.${table} \\(`, "i"));
  }

  assert.match(schema, /foreign key \(workspace_id, company_id\)[\s\S]*references public\.companies \(workspace_id, id\)/i);
  assert.match(schema, /foreign key \(workspace_id, canonical_email_address_id\)[\s\S]*references public\.canonical_email_addresses \(workspace_id, id\)/i);
  assert.match(schema, /unique \(workspace_id, lead_id\)/i);
  assert.match(schema, /unique \(workspace_id, lead_id, user_id\)/i);
});

test("Phase 1 enables RLS and protects its authorization invariants", () => {
  for (const table of phaseOneTables) {
    assert.match(rls, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }

  assert.match(rls, /create or replace function public\.is_active_workspace_member/i);
  assert.match(rls, /create or replace function public\.is_workspace_admin/i);
  assert.match(rls, /create trigger audit_events_are_immutable/i);
  assert.doesNotMatch(rls, /audit_events_(insert|update|delete)/i);
});

test("workspace viewer reads the authorized membership instead of Auth role metadata", () => {
  assert.match(session, /\.from\("workspace_members"\)/);
  assert.match(session, /\.eq\("user_id", user\.id\)/);
  assert.doesNotMatch(session, /user\.user_metadata\.role/);
  assert.doesNotMatch(session, /SurnMore workspace/);
});
