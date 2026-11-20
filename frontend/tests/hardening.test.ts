/**
 * Robustness: safe pagination, date notices, session lifetime, error messages,
 * confirmation popups, and the time zone staying in sync with the database.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  adjustmentConfirmation,
  employeeConfirmation,
  leaderboardConfirmation,
  metricConfirmation,
  pointsSettingsConfirmation,
  reviewConfirmation,
  rewardConfirmation,
  scoringRuleConfirmation,
  valueEditConfirmation,
} from "../src/lib/admin/confirmations.ts";
import { isLayoutGuardedPath } from "../src/lib/auth/routes.ts";
import { entryValuesVersion } from "../src/lib/metrics/values.ts";
import { parseReportFilters, parseSubmissionFilters } from "../src/lib/performance/filters.ts";
import { rpcErrorMessage } from "../src/lib/supabase/rpc-error.ts";
import { REMEMBER_MAX_AGE_SECONDS, applySessionPolicy } from "../src/lib/supabase/session-cookies.ts";
import { fetchPage, parsePage } from "../src/lib/utils/fetch-page.ts";
import type { AppSettings, MetricDefinition, MetricEntryValue, Profile, Reward, ScoringRule } from "../src/types/database.ts";

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};

describe("pagination", () => {
  const table = (rows: number) => async (from: number, to: number) => {
    if (from >= rows && from > 0) return { data: null, count: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } };
    return { data: Array.from({ length: Math.max(0, Math.min(to + 1, rows) - from) }, (_, i) => from + i), count: rows, error: null };
  };
  it("returns the requested page", async () => {
    assert.deepEqual(await fetchPage(table(25), 2, 10), { rows: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], total: 25, page: 2 });
  });
  it("a page past the end falls back to the last page instead of crashing", async () => {
    const result = await fetchPage(table(25), 999, 10);
    assert.equal(result.page, 3);
    assert.deepEqual(result.rows, [20, 21, 22, 23, 24]);
  });
  it("an empty list falls back to page 1", async () => {
    assert.deepEqual(await fetchPage(table(0), 5, 10), { rows: [], total: 0, page: 1 });
  });
  it("other errors still surface", async () => {
    await assert.rejects(fetchPage(async () => ({ data: null, count: null, error: { code: "500", message: "boom" } }), 1, 10), /boom/);
  });
  it("page numbers from URLs are sanitised", () => {
    for (const bad of ["abc", "-3", "0", "1.5", "1e308", "", undefined, ["2"]]) assert.equal(parsePage(bad), 1, String(bad));
    assert.equal(parsePage("7"), 7);
  });
});

describe("date filters explain themselves", () => {
  const today = "2026-11-04";
  it("submissions: reversed dates are ignored with a notice", () => {
    const f = parseSubmissionFilters({ from: "2026-11-03", to: "2026-11-01" });
    assert.deepEqual([f.from, f.to], [null, null]);
    assert.match(f.notice ?? "", /after the To date/);
  });
  it("submissions: invalid dates give a notice", () => assert.match(parseSubmissionFilters({ from: "2026-02-30" }).notice ?? "", /wasn't valid/));
  it("reports: reversed, future and too-long ranges give a notice", () => {
    assert.match(parseReportFilters({ from: "2026-11-03", to: "2026-11-01" }, today).notice ?? "", /after the end date/);
    assert.match(parseReportFilters({ to: "2031-01-01" }, today).notice ?? "", /future/);
    assert.match(parseReportFilters({ from: "2020-01-01" }, today).notice ?? "", /up to 366 days/);
  });
  it("a valid range has no notice", () => assert.equal(parseReportFilters({ from: "2026-10-01", to: "2026-10-31" }, today).notice, null));
});

describe("session lifetime", () => {
  it("'keep me signed in' is capped at 30 days (idle limit)", () => {
    assert.equal(applySessionPolicy({ maxAge: 34_560_000 }, true).maxAge, REMEMBER_MAX_AGE_SECONDS);
  });
  it("without it, cookies end with the browser session", () => assert.equal(applySessionPolicy({ maxAge: 34_560_000 }, false).maxAge, undefined));
  it("sign-out deletions are left alone", () => assert.equal(applySessionPolicy({ maxAge: 0 }, true).maxAge, 0));
});

it("only sections with their own layout guard skip the proxy's profile lookup", () => {
  for (const p of ["/admin", "/admin/reports/export", "/employee/points", "/profile"]) assert.ok(isLayoutGuardedPath(p), p);
  for (const p of ["/", "/login", "/dashboard", "/forgot-password", "/administrator", "/employees", "/profiles"]) assert.ok(!isLayoutGuardedPath(p), p);
});

describe("database messages", () => {
  it("removes the table prefix and capitalises", () => {
    assert.equal(rpcErrorMessage({ code: "42501", message: "metric_entries: cannot change status" }, "x"), "Cannot change status");
  });
  it("hides Postgres' own check-constraint wording", () => {
    assert.equal(rpcErrorMessage({ code: "23514", message: 'new row violates check constraint "x"' }, "fallback"), "fallback");
  });
});

it("entry version changes when any value changes", () => {
  const a = [{ updated_at: "2026-11-04T10:00:00Z" }, { updated_at: "2026-11-04T11:00:00Z" }];
  assert.equal(entryValuesVersion(a), "2026-11-04T11:00:00Z");
  assert.notEqual(entryValuesVersion([...a, { updated_at: "2026-11-04T12:00:00Z" }]), entryValuesVersion(a));
});

it("the app's time zone matches the database's", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const database = read("../../backend/supabase/migrations/20261104000100_phase2_metrics_goals.sql").match(/now\(\) at time zone '([^']+)'/)?.[1];
  assert.equal(read("../.env.example").match(/^NEXT_PUBLIC_APP_TIME_ZONE=(.+)$/m)?.[1], database);
  assert.ok(read("../src/lib/utils/format.ts").includes(`"${database}"`));
});

describe("confirmation popups", () => {
  const employee = { full_name: "Nina", email: "n@x", role: "employee", employee_category: "nurse", is_active: true } as Profile;
  const unchanged = { role: "employee", employee_category: "nurse", is_active: "on", full_name: "Nina Renamed" };

  it("routine employee edits go straight through", () => assert.equal(employeeConfirmation(employee, form(unchanged)), null));
  it("deactivating is destructive and mentions reward requests", () => {
    const c = employeeConfirmation(employee, form({ role: "employee", employee_category: "nurse" }));
    assert.equal(c?.title, "Deactivate Nina?");
    assert.ok(c?.destructive);
    assert.ok(c?.details.some((d) => d.includes("reward requests")));
  });
  it("role and category changes ask, and say what changes", () => {
    assert.match(employeeConfirmation(employee, form({ ...unchanged, role: "admin" }))?.details[0] ?? "", /administrator/);
    assert.match(employeeConfirmation(employee, form({ ...unchanged, employee_category: "beauty_therapist" }))?.details[0] ?? "", /Nurse to Beauty Therapist/);
  });
  it("reactivating asks", () => assert.ok(employeeConfirmation({ ...employee, is_active: false }, form(unchanged))));

  it("reviews: routine decisions go through, risky ones ask", () => {
    assert.equal(reviewConfirmation("pending", form({ decision: "approve" })), null);
    assert.equal(reviewConfirmation("pending", form({ decision: "correction" })), null);
    assert.ok(reviewConfirmation("pending", form({ decision: "reject" }))?.destructive);
    assert.match(reviewConfirmation("approved", form({ decision: "correction" }))?.details.join() ?? "", /points/);
    assert.match(reviewConfirmation("approved", form({ decision: "reject" }))?.details.join() ?? "", /taken back/);
    assert.ok(reviewConfirmation("rejected", form({ decision: "approve" })));
  });

  it("value edits list old → new, and nothing changed means no popup", () => {
    const m = { id: "rev", name: "Revenue", data_type: "currency", unit: "$" } as MetricDefinition;
    const values = [{ metric_id: "rev", value: 2000 }] as MetricEntryValue[];
    assert.equal(valueEditConfirmation("approved", [m], values, form({ rev: "2000" })), null);
    const c = valueEditConfirmation("approved", [m], values, form({ rev: "2,400" }));
    assert.equal(c?.details[0], "Revenue: $2,000.00 → $2,400.00");
    assert.ok(c?.details.some((d) => d.includes("recalculated")));
  });

  it("metrics: disabling asks; new metrics and renames don't", () => {
    const metric = { name: "Revenue", kind: "input", is_active: true, is_scoring_eligible: false, is_goal_eligible: false, counts_as_unit: false } as MetricDefinition;
    assert.equal(metricConfirmation(undefined, form({})), null);
    assert.equal(metricConfirmation(metric, form({ is_active: "on" })), null);
    assert.equal(metricConfirmation(metric, form({}))?.title, "Disable Revenue?");
  });

  it("scoring rules: only real changes ask", () => {
    const rule = { points: 50, threshold: 1000, period: "weekly", is_active: true } as ScoringRule;
    assert.equal(scoringRuleConfirmation(rule, form({ points: "50", threshold: "1000", period: "weekly", is_active: "on" })), null);
    assert.equal(scoringRuleConfirmation(rule, form({ points: "60", threshold: "1000", period: "weekly", is_active: "on" }))?.details[0], "Points: 50 → 60");
    assert.equal(scoringRuleConfirmation(undefined, form({})), null);
  });

  it("adjustments always ask and show the reason", () => {
    const c = adjustmentConfirmation("Nina", form({ amount: "-20", reason: "Duplicate bonus" }));
    assert.equal(c.title, "Remove 20 points from Nina?");
    assert.ok(c.destructive);
    assert.equal(c.details[0], "Reason: Duplicate bonus");
    assert.equal(adjustmentConfirmation("Nina", form({ amount: "1,000", reason: "Bonus pay" })).title, "Add 1,000 points to Nina?");
  });

  it("rewards: deactivating and price changes ask", () => {
    const reward = { name: "Coffee", points_cost: 50, is_active: true } as Reward;
    assert.equal(rewardConfirmation(reward, form({ points_cost: "50", is_active: "on" })), null);
    assert.ok(rewardConfirmation(reward, form({ points_cost: "50" }))?.destructive);
    assert.match(rewardConfirmation(reward, form({ points_cost: "75", is_active: "on" }))?.details[0] ?? "", /50 → 75/);
  });

  it("settings: only real changes ask", () => {
    const s = { points_start_date: "2026-11-03", streak_enabled: false, streak_min_days: 4, streak_weeks: 4, streak_points: 100 } as AppSettings;
    const same = { points_start_date: "2026-11-03", streak_min_days: "4", streak_weeks: "4", streak_points: "100" };
    assert.equal(pointsSettingsConfirmation(s, form(same)), null);
    assert.ok(pointsSettingsConfirmation(s, form({ ...same, streak_enabled: "on" })));
    assert.match(pointsSettingsConfirmation(s, form({ ...same, points_start_date: "2026-10-01" }))?.details[0] ?? "", /past periods/);
    assert.equal(leaderboardConfirmation(false, form({})), null);
    assert.match(leaderboardConfirmation(false, form({ overall_leaderboard_enabled: "on" }))?.title ?? "", /Show/);
  });
});
