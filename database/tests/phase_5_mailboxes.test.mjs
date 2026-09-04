import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../migrations/20260904000100_phase_5_mailbox_policy_domain.sql", import.meta.url), "utf8");
const mailboxData = await readFile(new URL("../../lib/mailboxes/mailboxes.ts", import.meta.url), "utf8");
const mailboxActions = await readFile(new URL("../../app/actions/mailboxes.ts", import.meta.url), "utf8");
const mailboxScreen = await readFile(new URL("../../components/screens/mailboxes-screen.tsx", import.meta.url), "utf8");

test("Phase 5 persists workspace mailbox state, policies, local-day usage, reservations, and health observations", () => {
  for (const table of [
    "mailboxes",
    "mailbox_sending_policies",
    "mailbox_daily_usage",
    "mailbox_capacity_reservations",
    "mailbox_health_observations",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }

  assert.match(migration, /create type public\.mailbox_status as enum \('active', 'paused'\)/i);
  assert.match(migration, /manual_pause boolean not null default false/i);
  assert.match(migration, /local_day_timezone text not null/i);
  assert.match(migration, /daily_capacity_limit integer not null/i);
  assert.match(migration, /ramp_enabled boolean not null default false/i);
  assert.match(migration, /mailbox_capacity_reservations_usage_fk/i);
  assert.match(migration, /unique \(workspace_id, mailbox_id, request_key\)/i);
  assert.match(migration, /Phase 5 deliberately supplies no ingestion command or automated status action/i);
});

test("Phase 5 config commands are manager-only and append auditable mailbox facts", () => {
  for (const command of ["mailbox_create", "mailbox_update_configuration", "mailbox_list_workspace_mailboxes"]) {
    assert.match(migration, new RegExp(`create function public\\.${command}`, "i"));
  }

  assert.match(migration, /mailbox_assert_manager/i);
  assert.match(migration, /'mailbox\.created'/i);
  assert.match(migration, /'mailbox\.configuration_updated'/i);
  assert.match(migration, /grant execute on function public\.mailbox_create[\s\S]*to authenticated/i);
  assert.match(migration, /grant execute on function public\.mailbox_update_configuration[\s\S]*to authenticated/i);
});

test("Phase 5 models atomic, idempotent daily capacity claims without exposing a sending path", () => {
  assert.match(migration, /create function public\.mailbox_reserve_daily_capacity/i);
  assert.match(migration, /create function public\.mailbox_finalize_daily_capacity/i);
  assert.match(migration, /mailbox_assert_capacity_worker/i);
  assert.match(migration, /for update;/i);
  assert.match(migration, /usage_record\.reserved_count \+ usage_record\.consumed_count \+ p_quantity > calculated_capacity/i);
  assert.match(migration, /on conflict \(workspace_id, mailbox_id, local_day\) do nothing/i);
  assert.match(migration, /grant execute on function public\.mailbox_reserve_daily_capacity[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.mailbox_reserve_daily_capacity[\s\S]*to authenticated/i);
  assert.match(migration, /Mailbox is paused and cannot reserve daily capacity/i);
});

test("Phase 5 replaces the static screen with server-backed, admin-only configuration controls", () => {
  assert.match(mailboxData, /getAuthorizedWorkspaceAccess/);
  assert.match(mailboxData, /isWorkspaceManagerRole\(workspaceAccess\.role\)/);
  assert.match(mailboxData, /mailbox_list_workspace_mailboxes/);
  assert.match(mailboxActions, /createMailboxAction/);
  assert.match(mailboxActions, /updateMailboxAction/);
  assert.match(mailboxActions, /validIanaTimezone/);
  assert.match(mailboxScreen, /Record mailbox/);
  assert.match(mailboxScreen, /Manual pause/);
  assert.match(mailboxScreen, /health automation, and dispatch remain intentionally disabled/i);
  assert.match(mailboxScreen, /canManageMailboxes/);
});
