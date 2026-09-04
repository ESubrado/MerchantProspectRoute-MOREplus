import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../migrations/20260903000300_phase_3_crm.sql", import.meta.url), "utf8");
const foundationSchema = await readFile(new URL("../migrations/20260903000100_phase_1_workspace_crm.sql", import.meta.url), "utf8");
const companiesData = await readFile(new URL("../../lib/crm/companies.ts", import.meta.url), "utf8");
const companiesActions = await readFile(new URL("../../app/actions/companies.ts", import.meta.url), "utf8");
const companiesScreen = await readFile(new URL("../../components/screens/companies-screen.tsx", import.meta.url), "utf8");
const contactsData = await readFile(new URL("../../lib/crm/contacts.ts", import.meta.url), "utf8");
const contactsActions = await readFile(new URL("../../app/actions/contacts.ts", import.meta.url), "utf8");
const contactsScreen = await readFile(new URL("../../components/screens/contacts-screen.tsx", import.meta.url), "utf8");

test("Phase 3 creates tenant-checked company directory and detail commands", () => {
  assert.match(migration, /create function public\.crm_search_companies/i);
  assert.match(migration, /create function public\.crm_get_company_detail/i);
  assert.match(migration, /create function public\.crm_create_company/i);
  assert.match(migration, /create function public\.crm_update_company/i);
  assert.match(migration, /if not public\.is_active_workspace_member\(p_workspace_id\)/i);
  assert.match(migration, /if not public\.is_workspace_admin\(p_workspace_id\)/i);
  assert.match(migration, /linked_contacts jsonb/i);
  assert.match(migration, /companies_workspace_normalized_name_key/i);
  assert.match(migration, /'company\.created'/i);
  assert.match(migration, /'company\.updated'/i);
});

test("Phase 3 contact commands preserve method, ownership, follower, and compliance invariants", () => {
  for (const command of [
    "crm_get_contact_detail",
    "crm_add_contact_email",
    "crm_remove_contact_email",
    "crm_add_contact_phone",
    "crm_remove_contact_phone",
    "crm_add_contact_social_profile",
    "crm_remove_contact_social_profile",
    "crm_set_contact_assignment",
    "crm_set_contact_following",
    "crm_set_contact_reply_state",
  ]) {
    assert.match(migration, new RegExp(`create function public\\.${command}`, "i"));
  }

  assert.match(foundationSchema, /unique \(workspace_id, lead_id\)/i);
  assert.match(migration, /on conflict \(workspace_id, lead_id, user_id\) do nothing/i);
  assert.match(migration, /next_email_dnc boolean/i);
  assert.match(migration, /'contact\.email_dnc_changed'/i);
  assert.match(migration, /'contact\.reply_temperature_changed'/i);
  assert.match(migration, /crm_update_contact_profile/i);
});

test("Phase 3 data layers reauthorize workspace access and the Companies route has no illustrative rows", () => {
  assert.match(companiesData, /getAuthorizedWorkspaceAccess/);
  assert.match(companiesData, /isWorkspaceManagerRole\(workspaceAccess\.role\)/);
  assert.match(companiesData, /p_workspace_id: workspaceAccess\.workspaceId/);
  assert.match(companiesActions, /uuidPattern\.test\(companyId\)/);
  assert.match(companiesScreen, /getCompanyDetailAction/);
  assert.doesNotMatch(companiesScreen, /const companies\s*=/);
  assert.match(contactsData, /crm_set_contact_reply_state/);
  assert.match(contactsData, /crm_set_contact_following/);
  assert.match(contactsActions, /setContactReplyStateAction/);
  assert.match(contactsActions, /setContactFollowingAction/);
  assert.match(contactsScreen, /Do not contact by email/);
  assert.match(contactsScreen, /Workspace followers/);
});
