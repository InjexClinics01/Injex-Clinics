import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchPage } from "@/lib/utils/fetch-page";
import type { AuditLog, EmployeeCategory, Profile } from "@/types/database";

/**
 * Server-side data access. All queries run as the signed-in user, so RLS
 * decides what is returned (employees only ever get their own row).
 */

export async function listProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("full_name", { ascending: true })
    .order("email", { ascending: true });
  if (error) throw new Error(`Could not load employees: ${error.message}`);
  return data;
}

export async function getProfile(id: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the employee: ${error.message}`);
  return data;
}

export async function listCategories(): Promise<EmployeeCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("employee_categories").select("*").order("name");
  if (error) throw new Error(`Could not load categories: ${error.message}`);
  return data;
}

export type StaffStats = {
  total: number;
  active: number;
  inactive: number;
  admins: number;
  unassigned: number;
  byCategory: Record<string, number>;
};

export function computeStaffStats(profiles: Profile[]): StaffStats {
  const stats: StaffStats = { total: 0, active: 0, inactive: 0, admins: 0, unassigned: 0, byCategory: {} };
  for (const p of profiles) {
    if (p.role === "admin") {
      stats.admins += 1;
      continue;
    }
    stats.total += 1;
    if (p.is_active) stats.active += 1;
    else stats.inactive += 1;
    if (!p.employee_category) stats.unassigned += 1;
    else if (p.is_active) stats.byCategory[p.employee_category] = (stats.byCategory[p.employee_category] ?? 0) + 1;
  }
  return stats;
}

export type ActivityItem = AuditLog & { actor: Pick<Profile, "full_name" | "email"> | null };

export async function listRecentActivity(limit = 8): Promise<ActivityItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*, actor:profiles!audit_logs_user_id_fkey(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load activity: ${error.message}`);
  return data as ActivityItem[];
}

export const AUDIT_FILTERS = {
  all: null,
  entries: ["metric_entry"],
  configuration: ["metric_definition", "scoring_rule", "app_settings"],
  points: ["points_transaction", "reward_redemption", "reward"],
  accounts: ["profile"],
} as const;
export type AuditFilter = keyof typeof AUDIT_FILTERS;
export const AUDIT_PAGE_SIZE = 25;

export async function listAuditLog(filter: AuditFilter, page: number) {
  const supabase = await createClient();
  const types = AUDIT_FILTERS[filter];
  return fetchPage<ActivityItem>(
    (from, to) => {
      let query = supabase
        .from("audit_logs")
        .select("*, actor:profiles!audit_logs_user_id_fkey(full_name, email)", { count: "exact" })
        .order("created_at", { ascending: false });
      if (types) query = query.in("entity_type", [...types]);
      return query.range(from, to) as unknown as PromiseLike<{
        data: ActivityItem[] | null;
        error: { code?: string; message: string } | null;
        count: number | null;
      }>;
    },
    page,
    AUDIT_PAGE_SIZE,
  ).catch((e: Error) => {
    throw new Error(`Could not load the audit log: ${e.message}`);
  });
}
