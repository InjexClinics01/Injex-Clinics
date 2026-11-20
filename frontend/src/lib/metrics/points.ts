import type { GoalPeriod, ScoringRule } from "@/types/database";

export type PointsEstimate = {
  /** Points for the highest rule threshold the goal target reaches (0 if none). */
  points: number;
  /** The next tier above the target, to show "set target ≥ X for Y points". */
  next: { threshold: number; points: number } | null;
};

/**
 * Estimated points for achieving a goal. Points come from admin scoring rules
 * for the metric and period, never from the goal itself: a goal target below
 * the rule threshold earns nothing, so easy goals cannot earn rewards.
 * Preview of the same rule the database uses to credit goal points (private.goal_tier_points).
 */
export function estimateGoalPoints(
  rules: ScoringRule[],
  metricId: string,
  period: GoalPeriod,
  target: number,
): PointsEstimate {
  const tiers = rules
    .filter((r) => r.is_active && r.metric_id === metricId && r.period === period)
    .sort((a, b) => a.threshold - b.threshold);

  const reached = tiers.filter((r) => r.threshold <= target);
  const next = tiers.find((r) => r.threshold > target);
  return {
    points: reached.length ? Math.max(...reached.map((r) => r.points)) : 0,
    next: next ? { threshold: next.threshold, points: next.points } : null,
  };
}
