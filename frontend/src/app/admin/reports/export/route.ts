import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { categoryLabel, entryStatusLabel } from "@/lib/constants";
import { parseReportFilters, type ReportFilters } from "@/lib/performance/filters";
import { toCsv, type CsvCell } from "@/lib/reports/csv";
import { createClient } from "@/lib/supabase/server";
import { listProfiles } from "@/services/employees";
import { appToday, listAllMetrics } from "@/services/metrics";
import { fetchAllPages, getReportSummaries } from "@/services/performance";
import type { MetricDefinition } from "@/types/database";

/**
 * CSV export of the report (opens in Excel). Admins only: requireAdmin() here,
 * and RLS returns other employees' data to admins only.
 *   ?type=summary  one row per employee (approved results for the range)
 *   ?type=entries  one row per submitted entry with every recorded value
 */
export async function GET(request: NextRequest) {
  await requireAdmin();
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const f = parseReportFilters(params, appToday());
  const type = params.type === "entries" ? "entries" : "summary";

  const csv = type === "entries" ? await entriesCsv(f) : await summaryCsv(f);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="performance-${type}_${f.from}_${f.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/** "Nurse: Revenue ($)" so mixed-category exports stay unambiguous. */
function metricHeader(m: MetricDefinition) {
  return `${categoryLabel(m.category)}: ${m.name}${m.unit ? ` (${m.unit})` : ""}`;
}

async function summaryCsv(f: ReportFilters) {
  const { shownCategories, metrics, summaries } = await getReportSummaries(f);
  const columns = metrics.filter((m) => m.is_active && shownCategories.some((c) => c.slug === m.category));
  return toCsv([
    ["From", "To", "Employee", "Email", "Category", "Active", "Approved days", "Goals achieved", "Goals completed", ...columns.map(metricHeader)],
    ...summaries.map((s) => [
      f.from,
      f.to,
      s.employee.full_name,
      s.employee.email,
      categoryLabel(s.employee.employee_category),
      s.employee.is_active ? "Yes" : "No",
      s.approvedDays,
      s.goalsAchieved,
      s.goalsCompleted,
      ...columns.map((m) => (m.category === s.employee.employee_category ? s.values[m.id] : null)),
    ]),
  ]);
}

async function entriesCsv(f: ReportFilters) {
  const supabase = await createClient();
  const [profiles, metrics, entries, values] = await Promise.all([
    listProfiles(),
    listAllMetrics(),
    fetchAllPages((from, to) => {
      let q = supabase
        .from("metric_entries")
        .select("id, employee_id, entry_date, category, status, final_rejection, review_note, submitted_at, reviewed_at")
        .neq("status", "draft")
        .gte("entry_date", f.from)
        .lte("entry_date", f.to);
      if (f.category) q = q.eq("category", f.category);
      if (f.employee) q = q.eq("employee_id", f.employee);
      return q.order("entry_date").order("id").range(from, to);
    }),
    fetchAllPages((from, to) => {
      let q = supabase
        .from("metric_entry_values")
        .select("id, entry_id, metric_id, value, entry:metric_entries!inner(entry_date, category, employee_id, status)")
        .neq("entry.status", "draft")
        .gte("entry.entry_date", f.from)
        .lte("entry.entry_date", f.to);
      if (f.category) q = q.eq("entry.category", f.category);
      if (f.employee) q = q.eq("entry.employee_id", f.employee);
      return q.order("id").range(from, to);
    }),
  ]);

  const people = new Map(profiles.map((p) => [p.id, p]));
  const usedCategories = new Set(entries.map((e) => e.category));
  const columns = metrics.filter((m) => usedCategories.has(m.category));
  const valuesByEntry = new Map<string, Map<string, number | null>>();
  for (const v of values) {
    if (!valuesByEntry.has(v.entry_id)) valuesByEntry.set(v.entry_id, new Map());
    valuesByEntry.get(v.entry_id)!.set(v.metric_id, v.value);
  }

  const rows: CsvCell[][] = entries.map((e) => {
    const person = people.get(e.employee_id);
    const recorded = valuesByEntry.get(e.id);
    return [
      e.entry_date,
      person?.full_name ?? "",
      person?.email ?? "",
      categoryLabel(e.category),
      entryStatusLabel(e.status, e.final_rejection),
      e.submitted_at,
      e.reviewed_at,
      e.review_note,
      ...columns.map((m) => recorded?.get(m.id) ?? null),
    ];
  });
  return toCsv([
    ["Date", "Employee", "Email", "Category", "Status", "Submitted at", "Reviewed at", "Review note", ...columns.map(metricHeader)],
    ...rows,
  ]);
}
