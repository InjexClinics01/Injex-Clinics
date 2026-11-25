import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  canAccessPath,
  homeForRole,
  isGuestOnlyPath,
  isLayoutGuardedPath,
  isPublicPath,
} from "@/lib/auth/routes";
import type { Database } from "@/types/database";
import { getSupabaseEnv, isSupabaseConfigured } from "./env";
import { applySessionPolicy, REMEMBER_COOKIE, shouldPersist } from "./session-cookies";

/**
 * Runs on every page request (see src/proxy.ts):
 *  1. Refreshes the Supabase session cookies.
 *  2. Redirects signed-out users away from protected pages.
 *  3. Sends signed-in users to their home, and signs out deactivated accounts.
 *
 * This is the first layer only. Role and active-status checks for /admin,
 * /employee and /profile happen in their layouts (lib/auth/session.ts), and the
 * database enforces everything with RLS.
 */
export async function updateSession(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!isSupabaseConfigured()) {
    // Fail closed: without configuration nobody is signed in.
    if (isGuestOnlyPath(pathname) || isPublicPath(pathname)) return NextResponse.next();
    return redirectTo(request, "/login", { error: "not_configured" });
  }

  let response = NextResponse.next({ request });
  const persist = shouldPersist(request.cookies.get(REMEMBER_COOKIE)?.value);
  const { url, publishableKey } = getSupabaseEnv();

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, applySessionPolicy(options, persist));
        }
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Do not run code between createServerClient and getClaims().
  // getClaims() verifies the JWT and refreshes an expired session.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (isPublicPath(pathname)) return response;

  if (!userId) {
    if (isGuestOnlyPath(pathname)) return response;
    const next = pathname === "/" ? undefined : `${pathname}${search}`;
    return withCookies(redirectTo(request, "/login", next ? { next } : {}), response);
  }

  if (pathname.startsWith("/admin")) {
    const cat = request.nextUrl.searchParams.get("category");
    if (cat && cat !== "overall") {
      response.cookies.set("admin_category", cat, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    }
  }

  // Each lookup is a database round trip on the critical path of every page.
  // These sections re-check in their layouts, pages, actions and route handlers
  // anyway, so a lookup here would only repeat that work.
  if (isLayoutGuardedPath(pathname)) return response;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut({ scope: "local" });
    const isPending =
      (data?.claims?.app_metadata as Record<string, unknown> | undefined)?.signup_status === "pending" ||
      (data?.claims?.user_metadata as Record<string, unknown> | undefined)?.signup_status === "pending";
    return withCookies(
      redirectTo(request, "/login", { error: isPending ? "registration_pending" : "account_inactive" }),
      response,
    );
  }

  if (isGuestOnlyPath(pathname) || pathname === "/" || pathname === "/dashboard") {
    return withCookies(redirectTo(request, homeForRole(profile.role)), response);
  }

  if (!canAccessPath(profile.role, pathname)) {
    return withCookies(redirectTo(request, homeForRole(profile.role), { error: "forbidden" }), response);
  }

  return response;
}

function redirectTo(request: NextRequest, pathname: string, params: Record<string, string> = {}) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/** Carry refreshed/cleared session cookies over to a redirect response. */
function withCookies(target: NextResponse, source: NextResponse) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  return target;
}
