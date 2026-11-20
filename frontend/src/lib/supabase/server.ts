import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/types/database";
import { getSupabaseEnv } from "./env";
import { applySessionPolicy, REMEMBER_COOKIE, shouldPersist } from "./session-cookies";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Acts as the signed-in user, so every query is subject to RLS.
 *
 * @param options.persistSession override "keep me signed in" (used at login).
 */
export async function createClient(options?: { persistSession?: boolean }) {
  // Read cookies first: this marks the route as request-time (dynamic).
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseEnv();
  const persist = options?.persistSession ?? shouldPersist(cookieStore.get(REMEMBER_COOKIE)?.value);

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, applySessionPolicy(options, persist));
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: the proxy refreshes the session on every request.
        }
      },
    },
  });
}
