import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseConfiguration } from "@/lib/supabase/config";

/** Creates a request-scoped Supabase client that persists refreshed auth cookies. */
export async function createClient() {
  const configuration = getSupabaseConfiguration();

  if (!configuration) {
    throw new Error("Supabase authentication is not configured.");
  }

  const cookieStore = await cookies();

  return createServerClient(configuration.url, configuration.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, options, value }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. The Proxy refreshes them.
        }
      },
    },
  });
}
