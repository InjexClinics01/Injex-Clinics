// Relative import (not "@/") so `node --test` can load this module directly.
import { addDays, daysBetween, formatBucket, periodStart } from "../metrics/periods.ts";
import type { GoalProgress, MetricDefinition, MetricSeriesRow, Profile, SubmissionStatsRow } from "@/types/database";

/**
 * Report calculations over approved data (pure, unit tested). Inputs come from
 * metric_series (one row per employee and metric for the whole range),
 * goal_progress and submission_stats.
 */

export type EmployeeSummary = {
  employee: Pick<Profile, "id" | "full_name" | "email" | "employee_category" | "is_active">;
  /** Approved entries in the range. */
  approvedDays: number;
  values: Record<string, number | null>;
  /** Goals whose period ended before today (the result is final). */
  goalsCompleted: number;
  goalsAchieved: number;
};

export function summariseEmployees(
  employees: EmployeeSummary["employee"][],
  series: MetricSeriesRow[],
  metrics: MetricDefinition[],
  goals: GoalProgress[],
  today: string,
): EmployeeSummary[] {
  const inputIds = new Set(metrics.filter((m) => m.kind === "input").map((m) => m.id));
  return employees.map((employee) => {
    const rows = series.filter((r) => r.employee_id === employee.id);
    const finished = goals.filter((g) => g.employee_id === employee.id && g.period_end < today);
    return {
      employee,
      // Required inputs are present on every submitted entry, so the largest count is the number of approved entries.
      approvedDays: Math.max(0, ...rows.filter((r) => inputIds.has(r.metric_id)).map((r) => r.entries_counted)),
      values: Object.fromEntries(rows.map((r) => [r.metric_id, r.value === null ? null : Number(r.value)])),
      goalsCompleted: finished.length,
      goalsAchieved: finished.filter((g) => isAchieved(g)).length,
    };
  });
}

export function isAchieved(goal: Pick<GoalProgress, "verified_value" | "target_value">): boolean {
  return goal.verified_value !== null && Number(goal.verified_value) >= Number(goal.target_value);
}

/** Percentage (one decimal), or null when there is nothing to divide by. */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** The metric a category is ranked by in reports: its first scoring-eligible metric, else its first metric. */
export function leadMetric(metrics: MetricDefinition[]): MetricDefinition | null {
  const active = metrics.filter((m) => m.is_active);
  return active.find((m) => m.is_scoring_eligible) ?? active[0] ?? null;
}

export function topPerformers(summaries: EmployeeSummary[], metricId: string, limit = 5): EmployeeSummary[] {
  return summaries
    .filter((s) => s.values[metricId] !== null && s.values[metricId] !== undefined)
    .sort((a, b) => (b.values[metricId] ?? 0) - (a.values[metricId] ?? 0) || a.employee.full_name.localeCompare(b.employee.full_name))
    .slice(0, limit);
}

/** Average per employee (employees without a value are left out) and the best result. */
export function teamStats(summaries: EmployeeSummary[], metricId: string) {
  const withValue = summaries.filter((s) => s.values[metricId] !== null && s.values[metricId] !== undefined);
  if (withValue.length === 0) return { average: null, best: null, count: 0 };
  const total = withValue.reduce((sum, s) => sum + (s.values[metricId] ?? 0), 0);
  const best = topPerformers(withValue, metricId, 1)[0];
  return { average: Math.round((total / withValue.length) * 10_000) / 10_000, best, count: withValue.length };
}

export type SubmissionBucket = { label: string; approved: number; pending: number; rejected: number };

/**
 * Chart buckets for the submission statistics, with empty days filled in.
 * Daily for ranges up to 62 days, weekly beyond that so bars stay readable.
 */
export function submissionBuckets(stats: SubmissionStatsRow[], from: string, to: string): { weekly: boolean; buckets: SubmissionBucket[] } {
  const weekly = daysBetween(from, to) > 61;
  const buckets = new Map<string, SubmissionBucket>();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const key = weekly ? periodStart("weekly", day) : day;
    if (!buckets.has(key)) buckets.set(key, { label: formatBucket(weekly ? "weekly" : "daily", key), approved: 0, pending: 0, rejected: 0 });
  }
  for (const s of stats) {
    const bucket = buckets.get(weekly ? periodStart("weekly", s.day) : s.day);
    if (!bucket) continue;
    bucket.approved += s.approved;
    bucket.pending += s.pending;
    bucket.rejected += s.rejected;
  }
  return { weekly, buckets: [...buckets.values()] };
}
