import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";
import { homeForRole } from "./routes";

/**
 * Data-access layer for the current user. Every protected page, layout and
 * server action calls one of the require* helpers, so authorisation does not
 * depend on the proxy alone. Results are memoised per request.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return profile ?? null;
});

/** Signed-in, active user of any role. */
export async function requireUser(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.is_active) redirect("/login?error=account_inactive");
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireUser();
  if (profile.role !== "admin") redirect(`${homeForRole(profile.role)}?error=forbidden`);
  return profile;
}

export async function requireEmployee(): Promise<Profile> {
  const profile = await requireUser();
  if (profile.role !== "employee") redirect(`${homeForRole(profile.role)}?error=forbidden`);
  return profile;
}
