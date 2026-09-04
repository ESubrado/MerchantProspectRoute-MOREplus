"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAuthorizedWorkspaceAccess } from "@/lib/auth/session";
import { getSupabaseConfiguration } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string } | null;

/** Authenticates with the project's own Supabase email/password provider. */
export async function login(_previousState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  if (!getSupabaseConfiguration()) {
    return { error: "Authentication is not configured yet. Ask your workspace administrator for help." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Invalid email or password." };
  }

  // Authentication creates a session; the DAL must separately confirm the tenant membership before entering protected routes.
  const workspaceAccess = await getAuthorizedWorkspaceAccess();

  if (!workspaceAccess) {
    return {
      error: "Your password was accepted, but this account does not have an active workspace membership. Ask a workspace administrator to grant access.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function logout() {
  if (getSupabaseConfiguration()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }

  revalidatePath("/", "layout");
  redirect("/login");
}
