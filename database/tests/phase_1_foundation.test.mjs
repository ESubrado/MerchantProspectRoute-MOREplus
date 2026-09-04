// These focused structural tests catch accidental removal of Phase 1 tables, RLS, or viewer authorization.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The fresh baseline keeps the complete Phase 1 schema, RLS, and owner authorization in one migration.
const phaseOneMigration = await readFile(new URL("../migrations/20260903000100_phase_1_workspace_crm.sql", import.meta.url), "utf8");
const schema = phaseOneMigration;
const rls = phaseOneMigration;
const session = await readFile(new URL("../../lib/auth/session.ts", import.meta.url), "utf8");
const authAction = await readFile(new URL("../../app/actions/auth.ts", import.meta.url), "utf8");

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
  // Fresh Phase 1 installations retain the owner role already present in the live membership table.
  assert.match(schema, /create type public\.workspace_role as enum \('owner', 'admin', 'member'\)/i);
});

test("Phase 1 enables RLS and protects its authorization invariants", () => {
  for (const table of phaseOneTables) {
    assert.match(rls, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }

  assert.match(rls, /create or replace function public\.is_active_workspace_member/i);
  assert.match(rls, /create or replace function public\.is_workspace_admin/i);
  assert.match(rls, /membership\.role in \('owner', 'admin'\)/i);
  assert.match(phaseOneMigration, /create type public\.workspace_role as enum \('owner', 'admin', 'member'\)/i);
  assert.match(phaseOneMigration, /membership\.role in \('owner', 'admin'\)/i);
  assert.match(rls, /create trigger audit_events_are_immutable/i);
  assert.doesNotMatch(rls, /audit_events_(insert|update|delete)/i);
});

test("workspace viewer reads the authorized membership instead of Auth role metadata", () => {
  assert.match(session, /\.from\("workspace_members"\)/);
  assert.match(session, /\.eq\("user_id", user\.id\)/);
  // The viewer deterministically chooses one RLS-authorized membership until a workspace picker exists.
  assert.match(session, /\.order\("created_at", \{ ascending: true \}\)[\s\S]*\.limit\(1\)/);
  assert.doesNotMatch(session, /user\.user_metadata\.role/);
  assert.doesNotMatch(session, /SurnMore workspace/);
});

test("login confirms workspace authorization before redirecting to protected routes", () => {
  // This prevents a successful password sign-in from turning into an unexplained redirect back to login.
  assert.match(authAction, /getAuthorizedWorkspaceAccess/);
  assert.match(authAction, /if \(!workspaceAccess\)[\s\S]*does not have an active workspace membership/);
});
