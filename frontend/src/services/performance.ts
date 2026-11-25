import "server-only";

import { periodEnd, periodStart, recentPeriods } from "@/lib/metrics/periods";
import type { ReportFilters } from "@/lib/performance/filters";
import { summariseEmployees } from "@/lib/reports/summary";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { listCategories, listProfiles } from "@/services/employees";
import { appToday, listAllMetrics, listGoalProgress, listMetrics } from "@/services/metrics";
import type {
  AppSettings,
  GoalPeriod,
  GoalProgress,
  LeaderboardRow,
  MetricSeriesRow,
  Profile,
  SubmissionStatsRow,
} from "@/types/database";

/**
 * Phase 3 data access: verified (approved-only) performance. Runs as the
 * signed-in user; the database decides what each role may see.
 */

/** Supabase returns at most 1,000 rows per request; read larger results in pages. */
const PAGE = 1000;
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function getLeaderboard(period: GoalPeriod, day: string, category: string | null): Promise<LeaderboardRow[]> {
  const userClient = await createClient();
  const adminClient = isAdminClientConfigured() ? createAdminClient() : userClient;
  const start = periodStart(period, day);
  const end = periodEnd(period, start);

  const [leaderboardRes, rulesRes, seriesRes] = await Promise.all([
    userClient.rpc("leaderboard", {
      p_period: period,
      p_day: day,
      ...(category ? { p_category: category } : {}),
    }),
    adminClient
      .from("scoring_rules")
      .select("*, metric_definitions(name, category, key)")
      .eq("is_active", true)
      .eq("period", period),
    adminClient.rpc("metric_series", {
      p_bucket: period,
      p_start: start,
      p_end: end,
      ...(category ? { p_category: category } : {}),
    }),
  ]);

  if (leaderboardRes.error) throw new Error(`Could not load the leaderboard: ${leaderboardRes.error.message}`);
  const rows: LeaderboardRow[] = leaderboardRes.data ?? [];
  const rules = (rulesRes.data ?? []) as any[];
  const series = (seriesRes.data ?? []) as any[];

  if (!rules.length || !rows.length) return rows;

  // Map employee_id -> metric_id -> value
  const valuesByEmp = new Map<string, Map<string, number>>();
  for (const s of series) {
    if (!valuesByEmp.has(s.employee_id)) valuesByEmp.set(s.employee_id, new Map());
    valuesByEmp.get(s.employee_id)!.set(s.metric_id, Number(s.value));
  }

  // Calculate proportional points per category and employee
  return rows.map((r) => {
    const empRules = rules.filter((rule) => rule.metric_definitions?.category === r.category);
    if (!empRules.length) return r;

    // Group rules by metric_id
    const rulesByMetric = new Map<string, any[]>();
    for (const rule of empRules) {
      if (!rulesByMetric.has(rule.metric_id)) rulesByMetric.set(rule.metric_id, []);
      rulesByMetric.get(rule.metric_id)!.push(rule);
    }

    let totalPoints = 0;
    let totalMax = 0;
    const empVals = valuesByEmp.get(r.employee_id);

    for (const [metricId, metricRules] of rulesByMetric.entries()) {
      const val = empVals?.get(metricId) ?? 0;
      let metricEarned = 0;
      let metricMax = 0;

      for (const rule of metricRules) {
        metricMax = Math.max(metricMax, rule.points);
        const threshold = Number(rule.threshold);
        if (threshold > 0) {
          const ratio = val / threshold;
          const pts = ratio >= 1 ? rule.points : Math.round(ratio * rule.points * 10) / 10;
          metricEarned = Math.max(metricEarned, pts);
        }
      }
      totalPoints += metricEarned;
      totalMax += metricMax;
    }

    // Attach raw metric values into r.metric_values so tooltips/comparisons work
    const metricValuesObj = { ...(r.metric_values ?? {}) };
    if (empVals) {
      for (const [mId, mVal] of empVals.entries()) {
        metricValuesObj[mId] = mVal;
      }
    }

    return {
      ...r,
      points: totalPoints,
      max_points: totalMax > 0 ? totalMax : r.max_points,
      metric_values: metricValuesObj,
    };
  });
}

/** Approved values per day/week/month (or for the whole range when `bucket` is null). */
export async function getMetricSeries(
  bucket: GoalPeriod | null,
  start: string,
  end: string,
  filter: { employee?: string | null; category?: string | null } = {},
): Promise<MetricSeriesRow[]> {
  const supabase = await createClient();
  return fetchAllPages((from, to) =>
    supabase
      .rpc("metric_series", {
        p_bucket: bucket,
        p_start: start,
        p_end: end,
        ...(filter.employee ? { p_employee: filter.employee } : {}),
        ...(filter.category ? { p_category: filter.category } : {}),
      })
      .range(from, to),
  ).catch((e: Error) => {
    throw new Error(`Could not load performance data: ${e.message}`);
  });
}

export async function getSubmissionStats(
  start: string,
  end: string,
  filter: { employee?: string | null; category?: string | null } = {},
): Promise<SubmissionStatsRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submission_stats", {
    p_start: start,
    p_end: end,
    ...(filter.employee ? { p_employee: filter.employee } : {}),
    ...(filter.category ? { p_category: filter.category } : {}),
  });
  if (error) throw new Error(`Could not load submission statistics: ${error.message}`);
  return data;
}

/** Active goals whose period ends within the range (for achievement rates). */
export async function listGoalsEndingBetween(start: string, end: string, employeeId?: string | null): Promise<GoalProgress[]> {
  const supabase = await createClient();
  return fetchAllPages((from, to) => {
    let query = supabase
      .from("goal_progress")
      .select("*")
      .eq("status", "active")
      .gte("period_end", start)
      .lte("period_end", end);
    if (employeeId) query = query.eq("employee_id", employeeId);
    return query.order("period_end").range(from, to);
  }).catch((e: Error) => {
    throw new Error(`Could not load goals: ${e.message}`);
  });
}

export async function getAppSettings(): Promise<AppSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("app_settings").select("*").single();
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  return data;
}

/** Everything the progress tracker shows for one employee (own page or an admin viewing them). */
export async function getProgressData(employee: Profile, view: GoalPeriod, metricId: string | null, bucketCount: number) {
  const today = appToday();
  const buckets = recentPeriods(view, today, bucketCount);
  const [metrics, series, goals] = await Promise.all([
    employee.employee_category ? listMetrics(employee.employee_category) : Promise.resolve([]),
    getMetricSeries(view, buckets[0], today, { employee: employee.id }),
    listGoalProgress(employee.id, today),
  ]);
  const active = metrics.filter((m) => m.is_active);
  const selected =
    active.find((m) => m.id === metricId) ?? active.find((m) => m.is_scoring_eligible) ?? active[0] ?? null;
  return { view, buckets, metrics: active, selected, series, goals };
}

/**
 * Per-employee results for a report range (shared by the reports page and the CSV export).
 * Includes active employees, and inactive ones who have approved data in the range.
 */
export async function getReportSummaries(f: ReportFilters) {
  const scope = { category: f.category, employee: f.employee };
  const [profiles, categories, metrics, series, goals] = await Promise.all([
    listProfiles(),
    listCategories(),
    listAllMetrics(),
    getMetricSeries(null, f.from, f.to, scope),
    listGoalsEndingBetween(f.from, f.to, f.employee),
  ]);
  const withData = new Set(series.map((r) => r.employee_id));
  const employees = profiles.filter(
    (p) =>
      p.role === "employee" &&
      p.employee_category &&
      (p.is_active || withData.has(p.id)) &&
      (!f.category || p.employee_category === f.category) &&
      (!f.employee || p.id === f.employee),
  );
  const summaries = summariseEmployees(employees, series, metrics, goals, appToday());
  const shownCategories = categories.filter((c) => summaries.some((s) => s.employee.employee_category === c.slug));
  return { profiles, categories, shownCategories, metrics, summaries };
}
