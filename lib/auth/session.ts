import { isWorkspaceRole, type WorkspaceRole } from "@/lib/auth/roles";
import { getSupabaseConfiguration } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type WorkspaceViewer = {
  avatarUrl: string | null;
  displayName: string;
  email: string;
  role: WorkspaceRole;
  workspaceName: string;
};

export type WorkspaceAccess = {
  role: WorkspaceViewer["role"];
  userId: string;
  workspaceId: string;
  workspaceName: string;
};

function metadataText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function metadataHttpUrl(value: unknown) {
  const url = metadataText(value);

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Narrows untyped PostgREST relationship data before it becomes an authorization result. */
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Accepts only the database-owned roles represented by the workspace membership contract. */
function workspaceRole(value: unknown): WorkspaceViewer["role"] | null {
  return isWorkspaceRole(value) ? value : null;
}

/** Resolves the active membership that supplies the current workspace context. */
export async function getAuthorizedWorkspaceAccess(): Promise<WorkspaceAccess | null> {
  if (!getSupabaseConfiguration()) {
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Until a workspace picker exists, select the oldest active membership deterministically from the user's JWT-authorized rows.
  const { data: membershipRows, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspace:workspaces(name)")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: true })
    .limit(1);

  if (membershipError || !membershipRows || membershipRows.length === 0) {
    return null;
  }

  const membership = record(membershipRows[0]);
  const workspace = record(membership?.workspace);
  const workspaceId = metadataText(membership?.workspace_id);
  const workspaceName = metadataText(workspace?.name);
  const role = workspaceRole(membership?.role);

  return workspaceId && workspaceName && role ? { role, userId: user.id, workspaceId, workspaceName } : null;
}

/** Resolves a signed-in user and their database-authorized workspace for the application shell. */
export async function getWorkspaceViewer(): Promise<WorkspaceViewer | null> {
  const workspaceAccess = await getAuthorizedWorkspaceAccess();

  if (!workspaceAccess) {
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const profileName = metadataText(user.user_metadata.full_name) || metadataText(user.user_metadata.name);
  const fallbackName = [
    metadataText(user.user_metadata.first_name),
    metadataText(user.user_metadata.last_name),
  ].filter(Boolean).join(" ");
  const displayName = profileName || fallbackName || user.email?.split("@")[0] || "Workspace user";
  const avatarUrl = metadataHttpUrl(user.user_metadata.avatar_url) ?? metadataHttpUrl(user.user_metadata.picture);

  return {
    avatarUrl,
    displayName,
    email: user.email ?? "Signed-in user",
    role: workspaceAccess.role,
    workspaceName: workspaceAccess.workspaceName,
  };
}
