// These structural checks keep the Contacts feature tied to tenant-scoped server commands until database integration tests are available.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../migrations/20260903000300_phase_2_contacts_commands.sql", import.meta.url), "utf8");
const lifecycleMigration = await readFile(new URL("../migrations/20260903000600_phase_2_lead_lifecycle_fields.sql", import.meta.url), "utf8");
const namePartsMigration = await readFile(new URL("../migrations/20260903000700_phase_2_contact_name_parts.sql", import.meta.url), "utf8");
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

test("Contacts lifecycle migration adds source-compatible lead state without weakening tenant commands", () => {
  for (const column of ["created_by", "email_dnc", "sms_dnc", "call_dnc", "reply_temperature", "stage", "status"]) {
    assert.match(lifecycleMigration, new RegExp(`add column ${column}`, "i"));
  }

  assert.match(lifecycleMigration, /auth\.uid\(\)/i);
  assert.match(lifecycleMigration, /p_reply_temperature = 3/i);
  assert.match(lifecycleMigration, /if not public\.is_active_workspace_member\(p_workspace_id\)/i);
  assert.match(lifecycleMigration, /if not public\.is_workspace_admin\(p_workspace_id\)/i);
  assert.match(lifecycleMigration, /'contact\.created'/i);
  assert.match(lifecycleMigration, /'contact\.updated'/i);
});

test("Contacts name-parts migration derives the directory name from first and last names", () => {
  assert.match(namePartsMigration, /p_first_name text/i);
  assert.match(namePartsMigration, /p_last_name text/i);
  assert.match(namePartsMigration, /normalized_full_name text := concat_ws\(' ', normalized_first_name, normalized_last_name\)/i);
  assert.match(namePartsMigration, /first_name = normalized_first_name/i);
  assert.match(namePartsMigration, /last_name = normalized_last_name/i);
  assert.match(namePartsMigration, /lead\.first_name/i);
  assert.match(namePartsMigration, /lead\.last_name/i);
});

test("Contacts data access forwards the authorized workspace id for reads and writes", () => {
  assert.match(dataLayer, /getAuthorizedWorkspaceAccess/);
  // Owners and administrators share the server-side contact-management guard.
  assert.match(dataLayer, /isWorkspaceManagerRole\(workspaceAccess\.role\)/);
  assert.match(dataLayer, /p_workspace_id: workspaceAccess\.workspaceId/);
  assert.match(dataLayer, /\.eq\("workspace_id", workspaceAccess\.workspaceId\)/);
  assert.match(actions, /function contactInput/);
  assert.match(actions, /uuidPattern\.test\(contactId\)/);
  assert.match(actions, /firstName/);
  assert.match(actions, /lastName/);
  assert.doesNotMatch(actions, /formData\.get\("fullName"\)/);
  assert.match(actions, /replyTemperature/);
  assert.match(actions, /emailDnc/);
  assert.match(dataLayer, /p_first_name: input\.firstName/);
  assert.match(dataLayer, /p_last_name: input\.lastName/);
  assert.match(dataLayer, /p_reply_temperature: input\.replyTemperature/);
  assert.match(dataLayer, /p_stage: input\.stage/);
  assert.match(dataLayer, /p_status: input\.status/);
});

test("Contacts screen has no illustrative list or disabled save action", () => {
  assert.doesNotMatch(screen, /const contacts\s*=/);
  assert.doesNotMatch(screen, /Preview-only|illustrative until the CRM backend/);
  assert.doesNotMatch(screen, /disabled>Save/);
  assert.match(screen, /Contacts pagination/);
  assert.match(screen, /Create contact/);
  assert.match(screen, /Do-not-contact preferences/);
  assert.match(screen, /Reply classification/);
  assert.match(screen, /First name/);
  assert.match(screen, /Last name/);
});
