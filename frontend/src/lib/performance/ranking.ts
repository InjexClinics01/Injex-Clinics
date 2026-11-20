import type { LeaderboardRow } from "@/types/database";

/**
 * Leaderboard ranking and comparisons. Pure functions so the rules are unit
 * tested; the database supplies points from approved entries only.
 */

export type RankedRow<T> = T & { rank: number | null };

/**
 * Standard competition ranking (1, 2, 2, 4): equal scores share a rank.
 * Rows without a score are listed last, unranked. Ties keep name order.
 */
export function rankRows<T extends { full_name: string }>(rows: T[], score: (row: T) => number | null): RankedRow<T>[] {
  const sorted = [...rows].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa === null || sb === null) return sa === sb ? byName(a, b) : sa === null ? 1 : -1;
    return sb - sa || byName(a, b);
  });

  let previous: number | null = null;
  let rank = 0;
  return sorted.map((row, index) => {
    const value = score(row);
    if (value === null) return { ...row, rank: null };
    if (value !== previous) rank = index + 1;
    previous = value;
    return { ...row, rank };
  });
}

function byName(a: { full_name: string }, b: { full_name: string }) {
  return a.full_name.localeCompare(b.full_name);
}

/**
 * Points as a percentage of the points available in the employee's category,
 * so categories with different scoring rules can share one overall board.
 * Null when the category has no scoring rules for the period.
 */
export function normalizedScore(row: Pick<LeaderboardRow, "points" | "max_points">): number | null {
  if (row.max_points <= 0) return null;
  return Math.round((row.points / row.max_points) * 1000) / 10;
}

/** Value of one metric for a leaderboard row (null when hidden or missing). */
export function metricScore(row: Pick<LeaderboardRow, "metric_values">, metricId: string): number | null {
  const value = row.metric_values?.[metricId];
  return value === undefined || value === null ? null : Number(value);
}

/** Percentage change from `previous` to `current`; null when it cannot be computed. */
export function percentChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
