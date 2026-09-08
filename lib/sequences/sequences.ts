import { isWorkspaceManagerRole } from "@/lib/auth/roles";
import { getAuthorizedWorkspaceCampaignAccess } from "@/lib/auth/session";
import { getSupabaseConfiguration } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type CampaignSequenceStatus = "active" | "archived" | "draft" | "paused";

export type SequenceScheduleWindow = {
  days: number[];
  endTime: string;
  startTime: string;
};

export type CampaignSequenceVariant = {
  body: string;
  id: string;
  subject: string;
  variantKey: string;
};

export type CampaignSequenceListItem = {
  id: string;
  jitterMaxMinutes: number;
  name: string;
  scheduleTimezone: string;
  status: CampaignSequenceStatus;
  updatedAt: string;
  variants: CampaignSequenceVariant[];
  weeklyWindows: SequenceScheduleWindow[];
};

export type SequenceConfigurationInput = {
  jitterMaxMinutes: number;
  scheduleTimezone: string;
  weeklyWindows: SequenceScheduleWindow[];
};

export type SequenceVariantInput = {
  body: string;
  subject: string;
};

export type SequencesPageResult =
  | {
    campaignName: string;
    canManageSequences: boolean;
    sequences: CampaignSequenceListItem[];
    type: "success";
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
function variantFromValue(value: unknown): CampaignSequenceVariant | null {
  const variant = record(value);
  const id = stringValue(variant?.id);
  const variantKey = stringValue(variant?.variant_key);
  const subject = stringValue(variant?.subject);
  const body = stringValue(variant?.body);
  if (!variant || !id || !variantKey || !subject || !body) return null;

  return { body, id, subject, variantKey };
}

/** Converts the database's direct-variant configuration projection into the sequence screen model. */
function sequenceFromRow(value: unknown): CampaignSequenceListItem | null {
  const row = record(value);
  const id = stringValue(row?.id);
  const name = stringValue(row?.name);
  const status = sequenceStatus(row?.status);
  const scheduleTimezone = stringValue(row?.schedule_timezone);
  const jitterMaxMinutes = numberValue(row?.jitter_max_minutes);
  const updatedAt = stringValue(row?.updated_at);
  const rawWindows = array(row?.weekly_windows);
  const rawVariants = array(row?.variants);

  if (!row || !id || !name || !status || !scheduleTimezone || jitterMaxMinutes === null || !updatedAt || !rawWindows || !rawVariants) return null;

  return {
    id,
    jitterMaxMinutes,
    name,
    scheduleTimezone,
    status,
    updatedAt,
    variants: rawVariants.map(variantFromValue).filter((variant: CampaignSequenceVariant | null): variant is CampaignSequenceVariant => variant !== null),
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
  };
}

/** Creates the next database-numbered Step N draft under the signed-in workspace's only campaign. */
export async function createCampaignSequence(input: { scheduleTimezone: string }): Promise<CommandResult> {
  const workspaceAccess = await managerWorkspaceAccess();
  if (!workspaceAccess) return managerAccessError();

  const supabase = await createClient();
  const { error } = await supabase.rpc("campaign_sequence_create", {
    p_schedule_timezone: input.scheduleTimezone,
    p_workspace_id: workspaceAccess.workspaceId,
  });

  return error ? commandError(error) : { type: "success" };
}

/** Stores a database-numbered step's schedule and timing metadata in one database transaction. */
export async function updateCampaignSequenceConfiguration(sequenceId: string, input: SequenceConfigurationInput): Promise<CommandResult> {
  const workspaceAccess = await managerWorkspaceAccess();
  if (!workspaceAccess) return managerAccessError();

  const supabase = await createClient();
  const { error } = await supabase.rpc("campaign_sequence_update_configuration", {
    p_jitter_max_minutes: input.jitterMaxMinutes,
    p_schedule_timezone: input.scheduleTimezone,
    p_sequence_id: sequenceId,
    p_weekly_windows: input.weeklyWindows.map((window) => ({
      days: window.days,
      end_time: window.endTime,
      start_time: window.startTime,
    })),
    p_workspace_id: workspaceAccess.workspaceId,
  });

  return error ? commandError(error) : { type: "success" };
}

/** Creates a new database-labeled direct variant when no ID is supplied, otherwise updates the owned variant atomically. */
export async function saveCampaignSequenceVariant(sequenceId: string, variantId: string | null, input: SequenceVariantInput): Promise<CommandResult> {
  return runSequenceCommand("campaign_sequence_save_variant", sequenceId, {
    p_body: input.body,
    p_subject: input.subject,
    p_variant_id: variantId,
  });
}

/** Deletes one direct variant; activation prerequisites are rechecked later. */
export async function deleteCampaignSequenceVariant(sequenceId: string, variantId: string): Promise<CommandResult> {
  return runSequenceCommand("campaign_sequence_delete_variant", sequenceId, { p_variant_id: variantId });
}

/** Removes one editable Step N configuration after the database protects history and compacts remaining generated labels. */
export async function deleteCampaignSequence(sequenceId: string): Promise<CommandResult> {
  return runSequenceCommand("campaign_sequence_delete", sequenceId, {});
}

/** Launches, pauses, or resumes every non-archived campaign step in one database transaction. */
export async function setCampaignLifecycleStatus(status: "active" | "paused"): Promise<CommandResult> {
  const workspaceAccess = await managerWorkspaceAccess();
  if (!workspaceAccess) return managerAccessError();

  const supabase = await createClient();
  const { error } = await supabase.rpc("campaign_sequence_set_campaign_status", {
    p_status: status,
    p_workspace_id: workspaceAccess.workspaceId,
  });

  return error ? commandError(error) : { type: "success" };
}

/** Archives one record; launch, pause, and resume must use the campaign-wide lifecycle command. */
export async function archiveCampaignSequence(sequenceId: string): Promise<CommandResult> {
  return runSequenceCommand("campaign_sequence_set_status", sequenceId, { p_status: "archived" });
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

  return error ? commandError(error) : { type: "success" };
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
function commandError(error: RpcError): CommandResult {
  if (error.code === "22023") return { message: "Check the schedule, template, and jitter values, then try again.", type: "error" };
  if (error.code === "23505") return { message: "A template variant key is already in use in this campaign.", type: "error" };
  if (error.code === "P0002") return { message: "This sequence configuration is no longer available. Refresh the page and try again.", type: "error" };
  if (error.code === "42501") return { message: "Your workspace permissions changed. Sign in again and try once more.", type: "error" };
  if (error.code === "55000") return {
    message: error.message?.includes("Campaign is active")
      ? "Pause the active campaign before adding a step."
      : error.message?.includes("Campaign is not active")
        ? "This campaign is already paused. Refresh the page and try again."
      : error.message?.includes("enrollment history")
        ? "This step has enrollment history and cannot be removed."
      : error.message?.includes("Activation requires")
        ? "Campaign launch requires every non-archived step to have a weekly window and at least one complete subject/body template variant."
        : "Pause the sequence before editing it. Archived sequences cannot be changed, and state transitions must follow the configured lifecycle.",
    type: "error",
  };
  return { message: "The sequence configuration could not be saved. Try again shortly.", type: "error" };
}
