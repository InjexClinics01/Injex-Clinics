import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { EmployeeRegistrationRequest } from "@/types/database";

/**
 * Fetch all pending employee registration requests for admin review.
 * Protected by RLS (only administrators receive rows).
 */
export async function listPendingRegistrationRequests(): Promise<EmployeeRegistrationRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_registration_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    // If the table is not yet created in the remote database, return empty array gracefully
    if (error.code === "PGRST205" || error.code === "42P01") {
      return [];
    }
    throw new Error(`Could not load registration requests: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Get count of pending registration requests for the badge notification.
 */
export async function countPendingRegistrationRequests(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("employee_registration_requests")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return 0;
    }
    return 0;
  }

  return count ?? 0;
}
