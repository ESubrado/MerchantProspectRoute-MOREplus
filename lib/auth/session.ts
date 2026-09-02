export type WorkspaceViewer = {
  avatarUrl: string | null;
  displayName: string;
  email: string;
};

import { getSupabaseConfiguration } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

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

/** Resolves the verified Supabase user for authenticated workspace routes. */
export async function getWorkspaceViewer(): Promise<WorkspaceViewer | null> {
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
  };
}
