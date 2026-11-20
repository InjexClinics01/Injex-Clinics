import "server-only";

import { SUBMISSIONS_PAGE_SIZE, type SubmissionFilters } from "@/lib/performance/filters";
import { createClient } from "@/lib/supabase/server";
import { fetchPage } from "@/lib/utils/fetch-page";
import type { ActivityItem } from "@/services/employees";
import type { MetricEntry, MetricEntryValue, Profile } from "@/types/database";

/**
 * Admin review queue. Runs as the signed-in admin: RLS lets admins read every
 * entry, and the pages call requireAdmin() first.
 */

type Person = Pick<Profile, "full_name" | "email">;

export type SubmissionRow = MetricEntry & { employee: Person; values: MetricEntryValue[] };

/** Escape LIKE wildcards so a search for "50%" matches literally. */
function likePattern(text: string) {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listSubmissions(f: SubmissionFilters) {
  const supabase = await createClient();

  // In the "All" tab (directory view), collapse to the single latest submission per employee
  if (f.tab === "all" && !f.employee) {
    let query = supabase
      .from("metric_entries")
      .select("*, employee:profiles!metric_entries_employee_id_fkey!inner(full_name, email), values:metric_entry_values(*)")
      .neq("status", "draft");

    if (f.category) query = query.eq("category", f.category);
    if (f.q) query = query.ilike("employee.full_name", likePattern(f.q));
    if (f.from) query = query.gte("entry_date", f.from);
    if (f.to) query = query.lte("entry_date", f.to);

    query = query.order("entry_date", { ascending: false }).order("submitted_at", { ascending: false });

    const { data, error } = await query;
    if (error) {
      throw new Error(`Could not load submissions: ${error.message}`);
    }

    const seen = new Set<string>();
    const latestRows = ((data as unknown as SubmissionRow[]) || []).filter((r) => {
      if (seen.has(r.employee_id)) return false;
      seen.add(r.employee_id);
      return true;
    });

    const total = latestRows.length;
    const start = (f.page - 1) * SUBMISSIONS_PAGE_SIZE;
    const pagedRows = latestRows.slice(start, start + SUBMISSIONS_PAGE_SIZE);

    return { rows: pagedRows, total, page: f.page };
  }

  return fetchPage<SubmissionRow>(
    (from, to) => {
      let query = supabase
        .from("metric_entries")
        .select("*, employee:profiles!metric_entries_employee_id_fkey!inner(full_name, email), values:metric_entry_values(*)", {
          count: "exact",
        })
        .neq("status", "draft");

      if (f.tab === "pending") query = query.eq("status", "pending");
      if (f.tab === "approved") query = query.eq("status", "approved");
      if (f.tab === "correction") query = query.eq("status", "rejected").eq("final_rejection", false);
      if (f.tab === "rejected") query = query.eq("status", "rejected").eq("final_rejection", true);
      if (f.category) query = query.eq("category", f.category);
      if (f.employee) query = query.eq("employee_id", f.employee);
      if (f.q) query = query.ilike("employee.full_name", likePattern(f.q));
      if (f.from) query = query.gte("entry_date", f.from);
      if (f.to) query = query.lte("entry_date", f.to);

      // The pending queue is worked oldest-first; everything else newest-first.
      query =
        f.tab === "pending"
          ? query.order("submitted_at", { ascending: true }).order("entry_date", { ascending: true })
          : query.order("entry_date", { ascending: false }).order("submitted_at", { ascending: false });
      return query.range(from, to) as unknown as PromiseLike<{
        data: SubmissionRow[] | null;
        error: { code?: string; message: string } | null;
        count: number | null;
      }>;
    },
    f.page,
    SUBMISSIONS_PAGE_SIZE,
  ).catch((e: Error) => {
    throw new Error(`Could not load submissions: ${e.message}`);
  });
}

export async function countPendingSubmissions(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("metric_entries")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw new Error(`Could not count submissions: ${error.message}`);
  return count ?? 0;
}

export type SubmissionDetail = MetricEntry & {
  employee: Person & Pick<Profile, "employee_category">;
  reviewer: Pick<Profile, "full_name"> | null;
  values: MetricEntryValue[];
  history: ActivityItem[];
};

export async function getSubmission(id: string): Promise<SubmissionDetail | null> {
  const supabase = await createClient();
  const [entry, history] = await Promise.all([
    supabase
      .from("metric_entries")
      .select(
        "*, employee:profiles!metric_entries_employee_id_fkey(full_name, email, employee_category), reviewer:profiles!metric_entries_reviewed_by_fkey(full_name), values:metric_entry_values(*)",
      )
      .eq("id", id)
      .neq("status", "draft")
      .maybeSingle(),
    supabase
      .from("audit_logs")
      .select("*, actor:profiles!audit_logs_user_id_fkey(full_name, email)")
      .eq("entity_type", "metric_entry")
      .eq("entity_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (entry.error) throw new Error(`Could not load submission: ${entry.error.message}`);
  if (history.error) throw new Error(`Could not load submission history: ${history.error.message}`);
  if (!entry.data) return null;

  return { ...(entry.data as Omit<SubmissionDetail, "history">), history: history.data as ActivityItem[] };
}

export type EmployeeSubmissionDate = {
  id: string;
  entry_date: string;
  status: string;
  final_rejection: boolean;
  submitted_at: string | null;
};

/**
 * Returns all past submission dates for a specific employee, ordered newest-first.
 * Used by the review screen date dropdown to switch between submissions.
 */
export async function getEmployeeSubmissionDates(employeeId: string): Promise<EmployeeSubmissionDate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("metric_entries")
    .select("id, entry_date, status, final_rejection, submitted_at")
    .eq("employee_id", employeeId)
    .neq("status", "draft")
    .order("entry_date", { ascending: false })
    .order("submitted_at", { ascending: false });

  if (error) {
    console.error("Could not fetch employee submission dates:", error.message);
    return [];
  }
  return (data as unknown as EmployeeSubmissionDate[]) ?? [];
}

