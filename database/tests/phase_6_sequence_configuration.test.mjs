import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../migrations/20260903000600_phase_6_sequence_configuration_drafts.sql", import.meta.url), "utf8");
const sequenceData = await readFile(new URL("../../lib/sequences/sequences.ts", import.meta.url), "utf8");
const sequenceActions = await readFile(new URL("../../app/actions/sequences.ts", import.meta.url), "utf8");
const sequenceScreen = await readFile(new URL("../../components/screens/sequences-screen.tsx", import.meta.url), "utf8");
const databaseReadme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const implementationPlan = await readFile(new URL("../../docs/implementation-plan.md", import.meta.url), "utf8");

test("Phase 6 makes each campaign sequence a complete draft configuration with schedule, pacing, steps, and variants", () => {
  assert.match(migration, /add column throttle_max_sends_per_hour integer not null default 60/i);
  assert.match(migration, /add column jitter_max_minutes integer not null default 0/i);
  assert.match(migration, /campaign_sequence_schedules_sequence_key[\s\S]*unique \(workspace_id, campaign_id, sequence_id\)/i);
  assert.match(migration, /add column subject text/i);
  assert.match(migration, /add column body text/i);
  assert.match(migration, /campaign_sequence_steps_position_key[\s\S]*deferrable initially immediate/i);
  assert.match(migration, /create function public\.campaign_sequence_update_configuration/i);
  assert.match(migration, /create function public\.campaign_sequence_create_step/i);
  assert.match(migration, /create function public\.campaign_sequence_save_step_variant/i);
  assert.match(migration, /jsonb_build_object\('subject', normalized_subject, 'body', normalized_body\)/i);
});

test("Phase 6 validates IANA timezones, non-overlapping windows, exact ordering, and activation prerequisites transactionally", () => {
  assert.match(migration, /create function public\.campaign_sequence_schedule_validate_configuration/i);
  assert.match(migration, /pg_catalog\.pg_timezone_names/i);
  assert.match(migration, /Weekly windows cannot overlap on the same weekday/i);
  assert.match(migration, /with ordinality as window_entry\(value, ordinality\)/i);
  assert.doesNotMatch(migration, /with ordinality as window\(value, ordinality\)/i);
  assert.match(migration, /create function public\.campaign_sequence_reorder_steps/i);
  assert.match(migration, /Reordering requires every current sequence step exactly once/i);
  assert.match(migration, /set constraints public\.campaign_sequence_steps_position_key deferred/i);
  assert.match(migration, /for update;/i);
  assert.match(migration, /create function public\.campaign_sequence_assert_activation_prerequisites/i);
  assert.match(migration, /Activation requires at least one weekly sending window/i);
  assert.match(migration, /Activation requires one or more contiguous ordered steps starting at position 1/i);
  assert.match(migration, /Activation requires at least one complete template variant on every step/i);
  assert.match(migration, /create function public\.campaign_sequence_set_status/i);
});

test("Phase 6 active sequences remain configuration-only and do not expose enrollment or dispatch behavior", () => {
  assert.match(migration, /It deliberately creates no enrollment state machine, router, queue, scheduler, provider adapter, webhook, or send path/i);
  assert.match(migration, /revoke all on function public\.campaign_sequence_enroll_lead\(uuid, uuid, uuid\) from authenticated/i);
  assert.match(migration, /automation_configured', false/i);
  assert.match(migration, /The list projection contains configuration facts only/i);
  assert.doesNotMatch(migration, /grant execute on function public\.campaign_sequence_enroll_lead[\s\S]*to authenticated/i);
  assert.match(sequenceScreen, /Automation not configured/i);
  assert.match(sequenceScreen, /cannot enroll contacts, route a mailbox, schedule work, or send email/i);
  assert.doesNotMatch(sequenceScreen, /Active enrollments/i);
});

test("Phase 6 derives sequence ownership from the signed-in workspace and validates untrusted form values", () => {
  assert.match(sequenceData, /getAuthorizedWorkspaceCampaignAccess/);
  assert.match(sequenceData, /campaign_sequence_update_configuration/);
  assert.match(sequenceData, /campaign_sequence_reorder_steps/);
  assert.match(sequenceData, /p_workspace_id: workspaceAccess\.workspaceId/);
  assert.match(sequenceActions, /sequenceConfigurationInput/);
  assert.match(sequenceActions, /validIanaTimezone/);
  assert.match(sequenceActions, /windowsOverlap/);
  assert.match(sequenceActions, /uuidPattern/);
  assert.match(sequenceActions, /revalidatePath\(actionPath\)/);
});

/** Guards the confirmation UI and the integrated migration that preserves ordered-step integrity after deletion. */
test("Phase 6 step deletion confirms intent and atomically cascades variants before repairing positions", () => {
  assert.match(migration, /drop constraint campaign_sequence_step_variants_step_fk/i);
  assert.match(migration, /references public\.campaign_sequence_steps \(workspace_id, campaign_id, sequence_id, id\) on delete cascade/i);
  assert.match(migration, /campaign_sequence_steps_position_key[\s\S]*deferrable initially immediate/i);
  assert.match(migration, /create or replace function public\.campaign_sequence_create/i);
  assert.match(migration, /campaign_sequence_create_step\(p_workspace_id, new_sequence_id, 0\)/i);
  assert.match(migration, /create function public\.campaign_sequence_delete_step/i);
  assert.match(migration, /delete from public\.campaign_sequence_steps/i);
  assert.match(migration, /set position = position - 1/i);
  assert.match(migration, /deleted_variant_count/i);
  assert.match(migration, /A sequence must retain at least one step\./);
  assert.match(migration, /grant execute on function public\.campaign_sequence_delete_step\(uuid, uuid, uuid\) to authenticated/i);
  assert.match(sequenceScreen, /aria-haspopup="dialog"/i);
  assert.match(sequenceScreen, /disabled=\{!canDelete\}/);
  assert.match(sequenceScreen, /One step minimum/);
  assert.match(sequenceScreen, /Delete step \{step\.position\}\?/);
  assert.match(sequenceScreen, /The remaining steps will be renumbered\./);
  assert.match(sequenceData, /20260903000600_phase_6_sequence_configuration_drafts\.sql/i);
  assert.match(migration, /create function public\.campaign_sequence_reorder_steps/i);
  assert.match(migration, /set constraints public\.campaign_sequence_steps_position_key deferred/i);
  assert.match(sequenceScreen, /useRouter/);
  assert.match(sequenceScreen, /router\.refresh\(\)/);
  assert.match(sequenceScreen, /Saved variants appear below/);
  assert.match(sequenceScreen, /function AddVariantForm/);
});

test("Phase 6 documentation calls out the migration, no new variables, and the missing automation boundary", () => {
  assert.match(databaseReadme, /Phase 6 sequence configuration drafts/i);
  assert.match(databaseReadme, /20260903000600_phase_6_sequence_configuration_drafts\.sql/i);
  assert.match(databaseReadme, /no new environment variables/i);
  assert.match(implementationPlan, /Phase 6/i);
  assert.match(implementationPlan, /Automation is not configured/i);
});
