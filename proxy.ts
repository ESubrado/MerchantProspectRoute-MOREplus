import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseConfiguration } from "@/lib/supabase/config";

/** Refreshes Supabase sessions and keeps unauthenticated visitors on the sign-in route. */
export async function proxy(request: NextRequest) {
  const configuration = getSupabaseConfiguration();
  const loginUrl = new URL("/login", request.url);

  if (!configuration) {
    return request.nextUrl.pathname === "/login" ? NextResponse.next() : NextResponse.redirect(loginUrl);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(configuration.url, configuration.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
        cookiesToSet.forEach(({ name, options, value }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Do not run logic between creating the client and retrieving the verified user.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname !== "/login") {
    // getUser() may have just removed an expired or revoked session. Preserve
    // those Set-Cookie updates on the redirect, or the browser will keep
    // sending the same invalid refresh token on the next request.
    const redirectResponse = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));

    for (const name of ["Cache-Control", "Expires", "Pragma"]) {
      const value = response.headers.get(name);
      if (value) redirectResponse.headers.set(name, value);
    }

    return redirectResponse;
  }

  // The login page redirects verified signed-in users to the workspace.
  if (user && request.nextUrl.pathname === "/login") {
    return response;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
