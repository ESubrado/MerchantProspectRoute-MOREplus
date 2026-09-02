// These structural checks keep the Contacts feature tied to tenant-scoped server commands until database integration tests are available.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../migrations/20260903000300_phase_2_contacts_commands.sql", import.meta.url), "utf8");
const dataLayer = await readFile(new URL("../../lib/crm/contacts.ts", import.meta.url), "utf8");
const actions = await readFile(new URL("../../app/actions/contacts.ts", import.meta.url), "utf8");
const screen = await readFile(new URL("../../components/screens/contacts-screen.tsx", import.meta.url), "utf8");

test("Contacts database commands independently enforce tenant membership and write audit facts", () => {
  assert.match(migration, /create or replace function public\.crm_search_contacts/i);
  assert.match(migration, /create or replace function public\.crm_create_contact/i);
  assert.match(migration, /create or replace function public\.crm_update_contact/i);
  assert.match(migration, /if not public\.is_active_workspace_member\(p_workspace_id\)/i);
  assert.match(migration, /if not public\.is_workspace_admin\(p_workspace_id\)/i);
  assert.match(migration, /'contact\.created'/i);
  assert.match(migration, /'contact\.updated'/i);
});

test("Contacts data access forwards the authorized workspace id for reads and writes", () => {
  assert.match(dataLayer, /getAuthorizedWorkspaceAccess/);
  // Owners and administrators share the server-side contact-management guard.
  assert.match(dataLayer, /isWorkspaceManagerRole\(workspaceAccess\.role\)/);
  assert.match(dataLayer, /p_workspace_id: workspaceAccess\.workspaceId/);
  assert.match(dataLayer, /\.eq\("workspace_id", workspaceAccess\.workspaceId\)/);
  assert.match(actions, /function contactInput/);
  assert.match(actions, /uuidPattern\.test\(contactId\)/);
});

test("Contacts screen has no illustrative list or disabled save action", () => {
  assert.doesNotMatch(screen, /const contacts\s*=/);
  assert.doesNotMatch(screen, /Preview-only|illustrative until the CRM backend/);
  assert.doesNotMatch(screen, /disabled>Save/);
  assert.match(screen, /Contacts pagination/);
  assert.match(screen, /Create contact/);
});
