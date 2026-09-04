import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseConfiguration } from "@/lib/supabase/config";

/** Creates a server-only client for owned background jobs and private Storage operations. */
export function createServiceClient() {
  const configuration = getSupabaseConfiguration();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!configuration || !serviceRoleKey) {
    throw new Error("The import worker requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createSupabaseClient(configuration.url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
