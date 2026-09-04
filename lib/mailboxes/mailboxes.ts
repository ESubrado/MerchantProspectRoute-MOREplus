import { isWorkspaceManagerRole, type WorkspaceRole } from "@/lib/auth/roles";
import { getAuthorizedWorkspaceAccess } from "@/lib/auth/session";
import { getSupabaseConfiguration } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type MailboxStatus = "active" | "paused";

export type MailboxListItem = {
  consumedCount: number;
  dailyCapacityLimit: number;
  displayName: string | null;
  effectiveDailyCapacity: number;
  emailAddress: string;
  healthObservedAt: string | null;
  healthScore: number | null;
  healthSource: string | null;
  healthSummary: string | null;
  id: string;
  localDay: string;
  localDayTimezone: string;
  manualPause: boolean;
  manualPausedAt: string | null;
  manualPauseReason: string | null;
  rampDailyIncrement: number | null;
  rampEnabled: boolean;
  rampInitialDailyCapacity: number | null;
  rampMaxDailyCapacity: number | null;
  rampStartDate: string | null;
  reservedCount: number;
  status: MailboxStatus;
  updatedAt: string;
};

export type MailboxWriteInput = {
  dailyCapacityLimit: number;
  displayName: string | null;
  emailAddress: string;
  localDayTimezone: string;
  manualPause: boolean;
  manualPauseReason: string | null;
  rampDailyIncrement: number | null;
  rampEnabled: boolean;
  rampInitialDailyCapacity: number | null;
  rampMaxDailyCapacity: number | null;
  rampStartDate: string | null;
  status: MailboxStatus;
};

export type MailboxesPageResult =
  | {
    canManageMailboxes: boolean;
    mailboxes: MailboxListItem[];
    type: "success";
    workspaceRole: WorkspaceRole;
  }
  | { message: string; type: "error" };

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function statusValue(value: unknown): MailboxStatus | null {
  return value === "active" || value === "paused" ? value : null;
}

function mailboxFromRow(value: unknown): MailboxListItem | null {
  const row = record(value);
  const id = stringValue(row?.id);
  const emailAddress = stringValue(row?.email_address);
  const status = statusValue(row?.status);
  const localDay = stringValue(row?.local_day);
  const localDayTimezone = stringValue(row?.local_day_timezone);
  const updatedAt = stringValue(row?.updated_at);
  const dailyCapacityLimit = numberValue(row?.daily_capacity_limit);
  const effectiveDailyCapacity = numberValue(row?.effective_daily_capacity);
  const reservedCount = numberValue(row?.reserved_count);
  const consumedCount = numberValue(row?.consumed_count);

  if (!row || !id || !emailAddress || !status || !localDay || !localDayTimezone || !updatedAt
    || dailyCapacityLimit === null || effectiveDailyCapacity === null || reservedCount === null || consumedCount === null) return null;

  return {
    consumedCount,
    dailyCapacityLimit,
    displayName: stringValue(row.display_name),
    effectiveDailyCapacity,
    emailAddress,
    healthObservedAt: stringValue(row.health_observed_at),
    healthScore: numberValue(row.health_score),
    healthSource: stringValue(row.health_source),
    healthSummary: stringValue(row.health_summary),
    id,
    localDay,
    localDayTimezone,
    manualPause: row.manual_pause === true,
    manualPausedAt: stringValue(row.manual_paused_at),
    manualPauseReason: stringValue(row.manual_pause_reason),
    rampDailyIncrement: numberValue(row.ramp_daily_increment),
    rampEnabled: row.ramp_enabled === true,
    rampInitialDailyCapacity: numberValue(row.ramp_initial_daily_capacity),
    rampMaxDailyCapacity: numberValue(row.ramp_max_daily_capacity),
    rampStartDate: stringValue(row.ramp_start_date),
    reservedCount,
    status,
    updatedAt,
  };
}

/** Loads mailbox state from the owned database projection; health rows are informational and never change status here. */
export async function getMailboxesPage(): Promise<MailboxesPageResult> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !getSupabaseConfiguration()) {
    return { message: "Your workspace access could not be verified. Sign in again and try once more.", type: "error" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mailbox_list_workspace_mailboxes", {
    p_workspace_id: workspaceAccess.workspaceId,
  });

  if (error) return { message: "Mailboxes could not be loaded right now. Apply the mailbox migration, then refresh the page.", type: "error" };

  return {
    canManageMailboxes: isWorkspaceManagerRole(workspaceAccess.role),
    mailboxes: (data ?? []).map(mailboxFromRow).filter((mailbox: MailboxListItem | null): mailbox is MailboxListItem => mailbox !== null),
    type: "success",
    workspaceRole: workspaceAccess.role,
  };
}

/** Records an externally provisioned mailbox only after app and database authorization agree on a manager role. */
export async function createWorkspaceMailbox(input: MailboxWriteInput): Promise<{ message?: string; type: "success" | "error" }> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !isWorkspaceManagerRole(workspaceAccess.role) || !getSupabaseConfiguration()) {
    return { message: "Only workspace owners and admins can configure mailboxes.", type: "error" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("mailbox_create", mailboxRpcInput(workspaceAccess.workspaceId, input));
  return error ? { message: mailboxSaveError(error.code), type: "error" } : { type: "success" };
}

/** Updates mailbox state and its policy together so a status change cannot escape the corresponding policy audit event. */
export async function updateWorkspaceMailbox(mailboxId: string, input: MailboxWriteInput): Promise<{ message?: string; type: "success" | "error" }> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();
  if (!workspaceAccess || !isWorkspaceManagerRole(workspaceAccess.role) || !getSupabaseConfiguration()) {
    return { message: "Only workspace owners and admins can configure mailboxes.", type: "error" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("mailbox_update_configuration", {
    ...mailboxRpcInput(workspaceAccess.workspaceId, input),
    p_mailbox_id: mailboxId,
  });
  return error ? { message: mailboxSaveError(error.code), type: "error" } : { type: "success" };
}

function mailboxRpcInput(workspaceId: string, input: MailboxWriteInput) {
  return {
    p_daily_capacity_limit: input.dailyCapacityLimit,
    p_display_name: input.displayName,
    p_email_address: input.emailAddress,
    p_local_day_timezone: input.localDayTimezone,
    p_manual_pause: input.manualPause,
    p_manual_pause_reason: input.manualPauseReason,
    p_ramp_daily_increment: input.rampDailyIncrement,
    p_ramp_enabled: input.rampEnabled,
    p_ramp_initial_daily_capacity: input.rampInitialDailyCapacity,
    p_ramp_max_daily_capacity: input.rampMaxDailyCapacity,
    p_ramp_start_date: input.rampStartDate,
    p_status: input.status,
    p_workspace_id: workspaceId,
  };
}

function mailboxSaveError(code: string | undefined) {
  if (code === "22023") return "Check the mailbox address, local-day timezone, capacity, ramp, and pause settings, then try again.";
  if (code === "23505") return "A mailbox with that email address already exists in this workspace.";
  if (code === "P0002") return "This mailbox is no longer available. Refresh the page and try again.";
  if (code === "42501") return "Your workspace permissions changed. Sign in again and try once more.";
  return "The mailbox configuration could not be saved. Try again shortly.";
}
