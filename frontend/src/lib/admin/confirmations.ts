// Relative imports (not "@/") so `node --test` can load this module directly.
import { categoryLabel } from "../constants.ts";
import { formatMetricValue } from "../metrics/values.ts";
import { formatPoints } from "../points/schemas.ts";
import type { AppSettings, EntryStatus, MetricDefinition, MetricEntryValue, Profile, Reward, ScoringRule } from "@/types/database";

/**
 * Which admin changes need a confirmation popup, and what it says. Each function
 * gets the form as it is about to be submitted and returns null when nothing
 * important changed (routine saves go straight through).
 */

export type Confirmation = {
  title: string;
  /** What will happen, one line each. */
  details: string[];
  confirmLabel: string;
  destructive?: boolean;
};

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const checked = (fd: FormData, key: string) => fd.get(key) === "on";
const number = (fd: FormData, key: string) => Number(text(fd, key).replace(/,/g, ""));

export function employeeConfirmation(employee: Profile, fd: FormData): Confirmation | null {
  const name = employee.full_name || employee.email;
  const role = text(fd, "role");
  const category = text(fd, "employee_category") || null;
  const active = checked(fd, "is_active");
  const deactivating = employee.is_active && !active;

  const details: string[] = [];
  if (deactivating) {
    details.push(
      "They are signed out straight away and can no longer sign in.",
      "Their pending reward requests are rejected and the reserved points released.",
      "Their history and points are kept, and you can reactivate them later.",
    );
  }
  if (!employee.is_active && active) details.push("They will be able to sign in again.");
  if (role !== employee.role) {
    details.push(
      role === "admin"
        ? "They become an administrator, with access to all staff data, points, rewards and settings."
        : "They lose administrator access.",
    );
  }
  if (category !== employee.employee_category) {
    details.push(
      `Category changes from ${categoryLabel(employee.employee_category)} to ${categoryLabel(category)}. New entries use that form; past entries stay as they are.`,
    );
  }
  if (details.length === 0) return null;
  return deactivating
    ? { title: `Deactivate ${name}?`, details, confirmLabel: "Deactivate", destructive: true }
    : { title: `Save these changes for ${name}?`, details, confirmLabel: "Save changes" };
}

/** Routine first decisions (approve, request a correction) need no popup. */
export function reviewConfirmation(status: EntryStatus, fd: FormData): Confirmation | null {
  const decision = text(fd, "decision");
  const pointsBack = "Any points already credited for it are taken back automatically.";

  if (decision === "reject") {
    return {
      title: "Reject this submission?",
      details: ["It is locked for the employee and won't count.", "They see your reason.", ...(status === "approved" ? [pointsBack] : [])],
      confirmLabel: "Reject",
      destructive: true,
    };
  }
  if (decision === "correction" && status === "approved") {
    return {
      title: "Reopen this approved entry?",
      details: ["It stops counting until it is corrected and approved again.", pointsBack],
      confirmLabel: "Request correction",
    };
  }
  if (decision === "approve" && status === "rejected") {
    return {
      title: "Overturn the earlier decision?",
      details: ["The entry will be approved and count towards performance and points."],
      confirmLabel: "Approve",
    };
  }
  return null;
}

export function valueEditConfirmation(
  status: EntryStatus,
  inputs: MetricDefinition[],
  values: MetricEntryValue[],
  fd: FormData,
): Confirmation | null {
  const details: string[] = [];
  for (const m of inputs) {
    const raw = text(fd, m.id).replace(/,/g, "");
    if (raw === "") continue;
    const before = values.find((v) => v.metric_id === m.id)?.value ?? null;
    const after = Number(raw);
    if (before !== after) {
      details.push(`${m.name}: ${formatMetricValue(before, m.data_type, m.unit)} → ${formatMetricValue(after, m.data_type, m.unit)}`);
    }
  }
  if (details.length === 0) return null;
  details.push("Your name and the old values are recorded in the audit trail.");
  if (status === "approved") details.push("Points for this period are recalculated if it has already been credited.");
  return { title: "Save these corrections?", details, confirmLabel: "Save corrections" };
}

export function metricConfirmation(metric: MetricDefinition | undefined, fd: FormData): Confirmation | null {
  if (!metric) return null;
  const details: string[] = [];
  const disabling = metric.is_active && !checked(fd, "is_active");
  if (disabling) details.push("It disappears from the daily form, and its goals and scoring rules stop earning points. Past entries keep it.");
  if (!disabling && metric.is_scoring_eligible && !checked(fd, "is_scoring_eligible")) details.push("Its scoring rules stop earning points.");
  if (!disabling && metric.is_goal_eligible && !checked(fd, "is_goal_eligible")) details.push("Staff can no longer set new goals on it. Goals already set are not affected.");
  if (metric.kind === "input" && metric.counts_as_unit !== checked(fd, "counts_as_unit")) details.push("This changes how Units Per Hour is calculated for new entries.");
  if (details.length === 0) return null;
  return {
    title: disabling ? `Disable ${metric.name}?` : `Change ${metric.name}?`,
    details,
    confirmLabel: disabling ? "Disable" : "Save changes",
    destructive: disabling,
  };
}

export function scoringRuleConfirmation(rule: ScoringRule | undefined, fd: FormData): Confirmation | null {
  if (!rule) return null;
  const details: string[] = [];
  if (rule.is_active && !checked(fd, "is_active")) details.push("The rule is switched off and stops earning points.");
  if (number(fd, "points") !== rule.points) details.push(`Points: ${rule.points} → ${number(fd, "points")}`);
  if (number(fd, "threshold") !== rule.threshold) details.push(`Threshold: ${rule.threshold} → ${number(fd, "threshold")}`);
  if (text(fd, "period") !== rule.period) details.push(`Period: ${rule.period} → ${text(fd, "period")}`);
  if (details.length === 0) return null;
  details.push("This applies to periods credited from now on. Points already credited don't change.");
  return { title: "Change this scoring rule?", details, confirmLabel: "Save changes" };
}

export function adjustmentConfirmation(employeeName: string, fd: FormData): Confirmation {
  const amount = number(fd, "amount");
  const size = formatPoints(Math.abs(amount));
  return {
    title: amount > 0 ? `Add ${size} points to ${employeeName}?` : `Remove ${size} points from ${employeeName}?`,
    details: [`Reason: ${text(fd, "reason")}`, "The employee sees the reason, and this is permanently recorded in the ledger and audit log."],
    confirmLabel: amount > 0 ? "Add points" : "Remove points",
    destructive: amount < 0,
  };
}

export function rewardConfirmation(reward: Reward | undefined, fd: FormData): Confirmation | null {
  if (!reward) return null;
  const deactivating = reward.is_active && !checked(fd, "is_active");
  const details: string[] = [];
  if (deactivating) details.push("Employees can no longer see or request it. Existing requests and history are kept.");
  const cost = number(fd, "points_cost");
  if (cost !== reward.points_cost) details.push(`Price: ${formatPoints(reward.points_cost)} → ${formatPoints(cost)} points. Existing requests keep the old price.`);
  if (details.length === 0) return null;
  return {
    title: deactivating ? `Deactivate ${reward.name}?` : `Change ${reward.name}?`,
    details,
    confirmLabel: deactivating ? "Deactivate" : "Save changes",
    destructive: deactivating,
  };
}

export function pointsSettingsConfirmation(settings: AppSettings, fd: FormData): Confirmation | null {
  const details: string[] = [];
  if (text(fd, "points_start_date") !== settings.points_start_date) {
    details.push(`Points start date: ${settings.points_start_date} → ${text(fd, "points_start_date")}. An earlier date can credit points for past periods.`);
  }
  if (checked(fd, "streak_enabled") !== settings.streak_enabled) details.push(`Streak bonus is switched ${checked(fd, "streak_enabled") ? "on" : "off"}.`);
  const streakChanged =
    number(fd, "streak_min_days") !== settings.streak_min_days ||
    number(fd, "streak_weeks") !== settings.streak_weeks ||
    number(fd, "streak_points") !== settings.streak_points;
  if (streakChanged) {
    details.push(`Streak: ${number(fd, "streak_points")} points for ${number(fd, "streak_weeks")} weeks in a row with ${number(fd, "streak_min_days")}+ approved days.`);
  }
  if (details.length === 0) return null;
  details.push("Points already credited don't change.");
  return { title: "Change the points settings?", details, confirmLabel: "Save settings" };
}

export function leaderboardConfirmation(currentlyEnabled: boolean, fd: FormData): Confirmation | null {
  const enabled = checked(fd, "overall_leaderboard_enabled");
  if (enabled === currentlyEnabled) return null;
  return enabled
    ? { title: "Show the overall leaderboard to employees?", details: ["All employees will see everyone's rank and normalised score, across categories."], confirmLabel: "Show it" }
    : { title: "Hide the overall leaderboard from employees?", details: ["Employees will only see their own category's leaderboard."], confirmLabel: "Hide it" };
}
