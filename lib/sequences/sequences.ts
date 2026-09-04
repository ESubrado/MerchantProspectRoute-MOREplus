import { isWorkspaceManagerRole, type WorkspaceRole } from "@/lib/auth/roles";
import { getAuthorizedWorkspaceCampaignAccess } from "@/lib/auth/session";
import { getSupabaseConfiguration } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type CampaignSequenceStatus = "active" | "archived" | "draft" | "paused";

export type SequenceScheduleWindow = {
  days: number[];
  endTime: string;
  startTime: string;
};

export type CampaignSequenceStepVariant = {
  body: string;
  id: string;
  subject: string;
  variantKey: string;
};

export type CampaignSequenceStep = {
  delayAfterPreviousMinutes: number;
  id: string;
  position: number;
  variants: CampaignSequenceStepVariant[];
};

export type CampaignSequenceListItem = {
  id: string;
  jitterMaxMinutes: number;
  name: string;
  scheduleTimezone: string;
  status: CampaignSequenceStatus;
  steps: CampaignSequenceStep[];
  throttleMaxSendsPerHour: number;
  updatedAt: string;
  weeklyWindows: SequenceScheduleWindow[];
};

export type SequenceConfigurationInput = {
  jitterMaxMinutes: number;
  name: string;
  scheduleTimezone: string;
  throttleMaxSendsPerHour: number;
  weeklyWindows: SequenceScheduleWindow[];
};

export type SequenceStepVariantInput = {
  body: string;
  subject: string;
  variantKey: string;
};

export type SequencesPageResult =
  | {
    campaignName: string;
    canManageSequences: boolean;
    sequences: CampaignSequenceListItem[];
    type: "success";
    workspaceRole: WorkspaceRole;
  }
  | { message: string; type: "error" };

type CommandResult = { message?: string; type: "error" | "success" };
type RecordValue = Record<string, unknown>;
type RpcError = { code?: string; message?: string };

/** Narrows untyped PostgREST values to plain records before reading their fields. */
function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}

/** Narrows untyped JSON values to arrays without trusting their element shape. */
function array(value: unknown) {
  return Array.isArray(value) ? value : null;
}

/** Returns only actual string values from an untyped database projection. */
function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

/** Accepts finite numeric values, including PostgREST's numeric-string representation. */
function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Limits status values to the database-owned sequence lifecycle. */
function sequenceStatus(value: unknown): CampaignSequenceStatus | null {
  return value === "draft" || value === "active" || value === "paused" || value === "archived" ? value : null;
}

/** Maps one JSON schedule window into the client DTO only when all required fields are present. */
function scheduleWindowFromValue(value: unknown): SequenceScheduleWindow | null {
  const window = record(value);
  const rawDays = array(window?.days);
  const startTime = stringValue(window?.start_time);
  const endTime = stringValue(window?.end_time);
  if (!window || !rawDays || !startTime || !endTime) return null;

  const days = rawDays.map(numberValue);
  if (days.some((day): day is null => day === null)) return null;

  return { days: days as number[], endTime, startTime };
}

/** Maps a provider-neutral variant projection without exposing malformed legacy rows. */
function variantFromValue(value: unknown): CampaignSequenceStepVariant | null {
  const variant = record(value);
  const id = stringValue(variant?.id);
  const variantKey = stringValue(variant?.variant_key);
  const subject = stringValue(variant?.subject);
  const body = stringValue(variant?.body);
  if (!variant || !id || !variantKey || !subject || !body) return null;

  return { body, id, subject, variantKey };
}

/** Maps an ordered step and discards invalid variants rather than widening the screen DTO. */
function stepFromValue(value: unknown): CampaignSequenceStep | null {
  const step = record(value);
  const id = stringValue(step?.id);
  const position = numberValue(step?.position);
  const delayAfterPreviousMinutes = numberValue(step?.delay_after_previous_minutes);
  const rawVariants = array(step?.variants);
  if (!step || !id || position === null || delayAfterPreviousMinutes === null || !rawVariants) return null;

  return {
    delayAfterPreviousMinutes,
    id,
    position,
    variants: rawVariants.map(variantFromValue).filter((variant: CampaignSequenceStepVariant | null): variant is CampaignSequenceStepVariant => variant !== null),
  };
}

/** Converts the database's nested configuration projection into the sequence screen model. */
function sequenceFromRow(value: unknown): CampaignSequenceListItem | null {
  const row = record(value);
  const id = stringValue(row?.id);
  const name = stringValue(row?.name);
  const status = sequenceStatus(row?.status);
  const scheduleTimezone = stringValue(row?.schedule_timezone);
  const throttleMaxSendsPerHour = numberValue(row?.throttle_max_sends_per_hour);
  const jitterMaxMinutes = numberValue(row?.jitter_max_minutes);
  const updatedAt = stringValue(row?.updated_at);
  const rawWindows = array(row?.weekly_windows);
  const rawSteps = array(row?.steps);

  if (!row || !id || !name || !status || !scheduleTimezone || throttleMaxSendsPerHour === null || jitterMaxMinutes === null || !updatedAt || !rawWindows || !rawSteps) return null;

  return {
    id,
    jitterMaxMinutes,
    name,
    scheduleTimezone,
    status,
    steps: rawSteps.map(stepFromValue).filter((step: CampaignSequenceStep | null): step is CampaignSequenceStep => step !== null).sort((left, right) => left.position - right.position),
    throttleMaxSendsPerHour,
    updatedAt,
    weeklyWindows: rawWindows.map(scheduleWindowFromValue).filter((window: SequenceScheduleWindow | null): window is SequenceScheduleWindow => window !== null),
  };
}

/** Reads configuration from the signed-in user's one resolved campaign; the browser never selects a campaign. */
export async function getSequencesPage(): Promise<SequencesPageResult> {
  const workspaceAccess = await getAuthorizedWorkspaceCampaignAccess();
  if (!workspaceAccess || !getSupabaseConfiguration()) {
    return { message: "Your workspace campaign could not be verified. Sign in again and try once more.", type: "error" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("campaign_sequence_list_workspace_sequences", {
    p_campaign_id: workspaceAccess.campaignId,
    p_workspace_id: workspaceAccess.workspaceId,
  });

  if (error) return { message: "Sequences could not be loaded right now. Apply the Phase 6 sequence migration, then refresh the page.", type: "error" };

  return {
    campaignName: workspaceAccess.campaignName,
    canManageSequences: isWorkspaceManagerRole(workspaceAccess.role),
    sequences: (data ?? []).map(sequenceFromRow).filter((sequence: CampaignSequenceListItem | null): sequence is CampaignSequenceListItem => sequence !== null),
    type: "success",
    workspaceRole: workspaceAccess.role,
  };
}

/** Creates an editable draft under the only campaign that belongs to the signed-in workspace. */
export async function createCampaignSequence(input: { name: string; scheduleTimezone: string }): Promise<CommandResult> {
  const workspaceAccess = await managerWorkspaceAccess();
  if (!workspaceAccess) return managerAccessError();

  const supabase = await createClient();
  const { error } = await supabase.rpc("campaign_sequence_create", {
    p_name: input.name,
    p_schedule_timezone: input.scheduleTimezone,
    p_workspace_id: workspaceAccess.workspaceId,
  });

  return error ? commandError(error) : { type: "success" };
}

/** Stores the schedule policy and metadata in one database transaction. */
export async function updateCampaignSequenceConfiguration(sequenceId: string, input: SequenceConfigurationInput): Promise<CommandResult> {
  const workspaceAccess = await managerWorkspaceAccess();
  if (!workspaceAccess) return managerAccessError();

  const supabase = await createClient();
  const { error } = await supabase.rpc("campaign_sequence_update_configuration", {
    p_jitter_max_minutes: input.jitterMaxMinutes,
    p_name: input.name,
    p_schedule_timezone: input.scheduleTimezone,
    p_sequence_id: sequenceId,
    p_throttle_max_sends_per_hour: input.throttleMaxSendsPerHour,
    p_weekly_windows: input.weeklyWindows.map((window) => ({
      days: window.days,
      end_time: window.endTime,
      start_time: window.startTime,
    })),
    p_workspace_id: workspaceAccess.workspaceId,
  });

  return error ? commandError(error) : { type: "success" };
}

/** Appends a step through the database command that locks the editable sequence. */
export async function createCampaignSequenceStep(sequenceId: string, delayAfterPreviousMinutes: number): Promise<CommandResult> {
  return runSequenceCommand("campaign_sequence_create_step", sequenceId, {
    p_delay_after_previous_minutes: delayAfterPreviousMinutes,
  });
}

/** Persists a step delay after server-side role and workspace checks. */
export async function updateCampaignSequenceStep(sequenceId: string, stepId: string, delayAfterPreviousMinutes: number): Promise<CommandResult> {
  return runSequenceCommand("campaign_sequence_update_step", sequenceId, {
    p_delay_after_previous_minutes: delayAfterPreviousMinutes,
    p_step_id: stepId,
  });
}

/** Deletes a non-final step through the transaction that cascades variants and closes positional gaps. */
export async function deleteCampaignSequenceStep(sequenceId: string, stepId: string): Promise<CommandResult> {
  return runSequenceCommand("campaign_sequence_delete_step", sequenceId, { p_step_id: stepId });
}

/** The database verifies that every current step ID appears exactly once before it commits new positions. */
export async function reorderCampaignSequenceSteps(sequenceId: string, stepIds: string[]): Promise<CommandResult> {
  return runSequenceCommand("campaign_sequence_reorder_steps", sequenceId, { p_step_ids: stepIds });
}

/** Creates a new variant when no ID is supplied, otherwise updates the owned variant atomically. */
export async function saveCampaignSequenceStepVariant(sequenceId: string, stepId: string, variantId: string | null, input: SequenceStepVariantInput): Promise<CommandResult> {
  return runSequenceCommand("campaign_sequence_save_step_variant", sequenceId, {
    p_body: input.body,
    p_step_id: stepId,
    p_subject: input.subject,
    p_variant_id: variantId,
    p_variant_key: input.variantKey,
  });
}

/** Deletes one variant from a known sequence step; activation prerequisites are rechecked later. */
export async function deleteCampaignSequenceStepVariant(sequenceId: string, stepId: string, variantId: string): Promise<CommandResult> {
  return runSequenceCommand("campaign_sequence_delete_step_variant", sequenceId, {
    p_step_id: stepId,
    p_variant_id: variantId,
  });
}

/** Activating validates a complete configuration; it remains an inert state until automation exists in a later phase. */
export async function setCampaignSequenceStatus(sequenceId: string, status: CampaignSequenceStatus): Promise<CommandResult> {
  return runSequenceCommand("campaign_sequence_set_status", sequenceId, { p_status: status });
}

/** Resolves the manager's workspace before invoking an RPC; no command accepts a campaign ID from the browser. */
async function runSequenceCommand(command: string, sequenceId: string, argumentsForCommand: Record<string, unknown>): Promise<CommandResult> {
  const workspaceAccess = await managerWorkspaceAccess();
  if (!workspaceAccess) return managerAccessError();

  const supabase = await createClient();
  const { error } = await supabase.rpc(command, {
    ...argumentsForCommand,
    p_sequence_id: sequenceId,
    p_workspace_id: workspaceAccess.workspaceId,
  });

  return error ? commandError(error, command) : { type: "success" };
}

/** Returns campaign access only for a currently authorized workspace owner or admin. */
async function managerWorkspaceAccess() {
  const workspaceAccess = await getAuthorizedWorkspaceCampaignAccess();
  return workspaceAccess && isWorkspaceManagerRole(workspaceAccess.role) && getSupabaseConfiguration() ? workspaceAccess : null;
}

/** Produces the consistent failure response for non-manager sequence mutations. */
function managerAccessError(): CommandResult {
  return { message: "Only workspace owners and admins can configure sequences.", type: "error" };
}

/** Maps database error classes to actionable, operation-aware, and non-sensitive configuration feedback. */
function commandError(error: RpcError, command?: string): CommandResult {
  if (error.code === "22023") return { message: "Check the sequence name, schedule, ordering, delay, template, throttle, and jitter values, then try again.", type: "error" };
  if (error.code === "23505") return { message: "A sequence name or template variant key is already in use in this campaign.", type: "error" };
  if (error.code === "P0002") return { message: "This sequence configuration is no longer available. Refresh the page and try again.", type: "error" };
  if (error.code === "42501") return { message: "Your workspace permissions changed. Sign in again and try once more.", type: "error" };
  if (error.code === "55000") return {
    message: error.message?.includes("retain at least one step")
      ? "A sequence must retain at least one step."
      : error.message?.includes("Activation requires")
        ? "Activation requires a weekly window, contiguous ordered steps, and at least one complete template variant on every step."
        : "Pause the sequence before editing it. Archived sequences cannot be changed, and state transitions must follow the configured lifecycle.",
    type: "error",
  };
  if (command === "campaign_sequence_delete_step") {
    return { message: "Step deletion needs the Phase 6 database migration. Apply 20260903000600_phase_6_sequence_configuration_drafts.sql, then refresh and try again.", type: "error" };
  }
  return { message: "The sequence configuration could not be saved. Try again shortly.", type: "error" };
}
