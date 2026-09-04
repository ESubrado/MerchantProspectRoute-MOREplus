import { isWorkspaceManagerRole, type WorkspaceRole } from "@/lib/auth/roles";
import { getAuthorizedWorkspaceCampaignAccess } from "@/lib/auth/session";
import { getSupabaseConfiguration } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type CampaignSequenceStatus = "active" | "archived" | "draft" | "paused";

export type CampaignSequenceListItem = {
  activeEnrollmentCount: number;
  id: string;
  name: string;
  scheduleTimezone: string;
  status: CampaignSequenceStatus;
  stepCount: number;
  updatedAt: string;
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

function sequenceStatus(value: unknown): CampaignSequenceStatus | null {
  return value === "draft" || value === "active" || value === "paused" || value === "archived" ? value : null;
}

function sequenceFromRow(value: unknown): CampaignSequenceListItem | null {
  const row = record(value);
  const id = stringValue(row?.id);
  const name = stringValue(row?.name);
  const status = sequenceStatus(row?.status);
  const scheduleTimezone = stringValue(row?.schedule_timezone);
  const stepCount = numberValue(row?.step_count);
  const activeEnrollmentCount = numberValue(row?.active_enrollment_count);
  const updatedAt = stringValue(row?.updated_at);

  if (!row || !id || !name || !status || !scheduleTimezone || stepCount === null || activeEnrollmentCount === null || !updatedAt) return null;

  return { activeEnrollmentCount, id, name, scheduleTimezone, status, stepCount, updatedAt };
}

/** Reads only the signed-in user's workspace campaign; the client never chooses a campaign identifier. */
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

  if (error) return { message: "Sequences could not be loaded right now. Apply the Phase 5.1 campaign migration, then refresh the page.", type: "error" };

  return {
    campaignName: workspaceAccess.campaignName,
    canManageSequences: isWorkspaceManagerRole(workspaceAccess.role),
    sequences: (data ?? []).map(sequenceFromRow).filter((sequence: CampaignSequenceListItem | null): sequence is CampaignSequenceListItem => sequence !== null),
    type: "success",
    workspaceRole: workspaceAccess.role,
  };
}

/** Creates an inert draft under the single resolved campaign; a later phase owns step, variant, and schedule editing. */
export async function createCampaignSequence(input: { name: string; scheduleTimezone: string }): Promise<{ message?: string; type: "error" | "success" }> {
  const workspaceAccess = await getAuthorizedWorkspaceCampaignAccess();
  if (!workspaceAccess || !isWorkspaceManagerRole(workspaceAccess.role) || !getSupabaseConfiguration()) {
    return { message: "Only workspace owners and admins can create sequences.", type: "error" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("campaign_sequence_create", {
    p_name: input.name,
    p_schedule_timezone: input.scheduleTimezone,
    p_workspace_id: workspaceAccess.workspaceId,
  });

  if (!error) return { type: "success" };
  if (error.code === "23505") return { message: "A sequence with that name already exists in this campaign.", type: "error" };
  if (error.code === "22023") return { message: "Check the sequence name and IANA schedule timezone, then try again.", type: "error" };
  if (error.code === "42501") return { message: "Your workspace permissions changed. Sign in again and try once more.", type: "error" };
  return { message: "The sequence could not be created. Try again shortly.", type: "error" };
}
