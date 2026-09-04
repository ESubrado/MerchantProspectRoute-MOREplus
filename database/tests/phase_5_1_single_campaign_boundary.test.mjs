import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../migrations/20260905000100_phase_5_1_single_campaign_boundary.sql", import.meta.url), "utf8");
const session = await readFile(new URL("../../lib/auth/session.ts", import.meta.url), "utf8");
const mailboxData = await readFile(new URL("../../lib/mailboxes/mailboxes.ts", import.meta.url), "utf8");
const sequenceData = await readFile(new URL("../../lib/sequences/sequences.ts", import.meta.url), "utf8");
const sequenceActions = await readFile(new URL("../../app/actions/sequences.ts", import.meta.url), "utf8");
const sequenceScreen = await readFile(new URL("../../components/screens/sequences-screen.tsx", import.meta.url), "utf8");
const targetArchitecture = await readFile(new URL("../../docs/target-architecture.md", import.meta.url), "utf8");
const implementationPlan = await readFile(new URL("../../docs/implementation-plan.md", import.meta.url), "utf8");
const gapRegister = await readFile(new URL("../../docs/backend-gap-register.md", import.meta.url), "utf8");

test("Phase 5.1 creates exactly one campaign per workspace during bootstrap and under concurrent resolution", () => {
  assert.match(migration, /create table public\.campaigns \(/i);
  assert.match(migration, /constraint campaigns_one_per_workspace_key unique \(workspace_id\)/i);
  assert.match(migration, /insert into public\.campaigns \(workspace_id, name, created_by\)[\s\S]*on conflict \(workspace_id\) do nothing/i);
  assert.match(migration, /create trigger workspaces_bootstrap_single_campaign[\s\S]*after insert on public\.workspaces/i);
  assert.match(migration, /create function public\.campaign_resolve_workspace_campaign/i);
  assert.match(migration, /for key share;/i);
  assert.match(migration, /on conflict \(workspace_id\) do nothing/i);
  assert.match(migration, /grant execute on function public\.campaign_resolve_workspace_campaign\(uuid\) to authenticated/i);
  assert.doesNotMatch(migration, /create function public\.campaign_create\(/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete) on table public\.campaigns to authenticated/i);
});

test("Phase 5.1 applies RLS and composite campaign ownership constraints to tenant outreach records", () => {
  for (const table of [
    "campaigns",
    "campaign_sequences",
    "campaign_sequence_schedules",
    "campaign_sequence_steps",
    "campaign_sequence_step_variants",
    "sequence_enrollments",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`create policy ${table}_select_active_members`, "i"));
  }

  assert.match(migration, /alter table public\.mailboxes add column campaign_id uuid/i);
  assert.match(migration, /mailboxes_campaign_workspace_fk[\s\S]*references public\.campaigns \(workspace_id, id\)/i);
  assert.match(migration, /alter table public\.mailbox_sending_policies add column campaign_id uuid/i);
  assert.match(migration, /mailbox_sending_policies_mailbox_campaign_workspace_fk[\s\S]*references public\.mailboxes \(workspace_id, campaign_id, id\)/i);
  assert.match(migration, /campaign_sequences_campaign_workspace_fk[\s\S]*references public\.campaigns \(workspace_id, id\)/i);
  assert.match(migration, /sequence_enrollments_sequence_fk[\s\S]*references public\.campaign_sequences \(workspace_id, campaign_id, id\)/i);
  assert.match(migration, /campaign_assert_workspace_campaign/i);
});

test("Phase 5.1 keeps the shared campaign mailbox pool and blocks concurrent active enrollment", () => {
  assert.match(migration, /Mailboxes deliberately have no sequence_id, so all campaign sequences share one routing pool/i);
  assert.match(migration, /create unique index sequence_enrollments_one_active_lead_per_workspace_key[\s\S]*on public\.sequence_enrollments \(workspace_id, lead_id\)[\s\S]*where status = 'active'/i);
  assert.match(migration, /create function public\.campaign_sequence_enroll_lead/i);
  assert.match(migration, /create function public\.campaign_sequence_end_enrollment/i);
  assert.match(migration, /Only an active sequence enrollment can be ended/i);
  assert.match(migration, /campaign_sequence_list_workspace_sequences[\s\S]*p_campaign_id uuid/i);
  assert.match(migration, /mailbox_list_workspace_mailboxes\(p_workspace_id uuid, p_campaign_id uuid\)/i);
  assert.match(migration, /mailbox_reserve_daily_capacity\([\s\S]*p_campaign_id uuid/i);
});

test("server data layers derive campaign context from membership rather than client campaign selection", () => {
  assert.match(session, /getAuthorizedWorkspaceCampaignAccess/);
  assert.match(session, /campaign_resolve_workspace_campaign/);
  assert.match(mailboxData, /getAuthorizedWorkspaceCampaignAccess/);
  assert.match(mailboxData, /p_campaign_id: workspaceAccess\.campaignId/);
  assert.match(sequenceData, /getAuthorizedWorkspaceCampaignAccess/);
  assert.match(sequenceData, /campaign_sequence_list_workspace_sequences/);
  assert.match(sequenceActions, /createSequenceAction/);
  assert.match(sequenceScreen, /single campaign/i);
  assert.doesNotMatch(sequenceScreen, /outreach programs/i);
});

test("architecture, plan, and gap register state the invariant and deliberate multi-campaign path", () => {
  for (const document of [targetArchitecture, implementationPlan, gapRegister]) {
    assert.match(document, /one workspace.{0,40}one campaign/i);
  }

  assert.match(targetArchitecture, /Future multi-campaign migration path/i);
  assert.match(targetArchitecture, /campaigns_one_per_workspace_key/i);
  assert.match(targetArchitecture, /Keep every existing `campaigns\.id` and every campaign-linked child row unchanged/i);
  assert.match(implementationPlan, /Exact future multi-campaign migration path/i);
  assert.match(gapRegister, /Phase 5\.1 campaign boundary/i);
});
