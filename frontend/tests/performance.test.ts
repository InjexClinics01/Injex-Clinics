/**
 * Phase 3 logic: rankings, normalised points, trends, period navigation,
 * review validation, URL filters, report summaries and CSV export.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { entryStatusLabel } from "../src/lib/constants.ts";
import { daysBetween, formatBucket, recentPeriods, shiftPeriod } from "../src/lib/metrics/periods.ts";
import { parseDay, parsePeriod, parseReportFilters, parseSubmissionFilters } from "../src/lib/performance/filters.ts";
import { metricScore, normalizedScore, percentChange, rankRows } from "../src/lib/performance/ranking.ts";
import { csvCell, toCsv } from "../src/lib/reports/csv.ts";
import { isAchieved, leadMetric, rate, submissionBuckets, summariseEmployees, teamStats, topPerformers } from "../src/lib/reports/summary.ts";
import { reviewSchema } from "../src/lib/review/schemas.ts";
import type { GoalProgress, LeaderboardRow, MetricDefinition, MetricSeriesRow } from "../src/types/database.ts";

const row = (full_name: string, points: number, max_points = 200, over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
  employee_id: full_name, full_name, category: "nurse", points, max_points, goals_set: 0, goals_achieved: 0,
  approved_days: 0, metric_values: null, team_average: null, ...over,
});

describe("leaderboard ranking", () => {
  it("ranks by score, highest first", () => {
    const ranked = rankRows([row("Bea", 50), row("Ada", 200), row("Cat", 100)], (r) => r.points);
    assert.deepEqual(ranked.map((r) => [r.full_name, r.rank]), [["Ada", 1], ["Cat", 2], ["Bea", 3]]);
  });
  it("equal scores share a rank and the next rank is skipped (1, 2, 2, 4)", () => {
    const ranked = rankRows([row("Dee", 10), row("Cat", 100), row("Bea", 100), row("Ada", 150)], (r) => r.points);
    assert.deepEqual(ranked.map((r) => [r.full_name, r.rank]), [["Ada", 1], ["Bea", 2], ["Cat", 2], ["Dee", 4]]);
  });
  it("everyone on zero shares first place", () => {
    assert.deepEqual(rankRows([row("B", 0), row("A", 0)], (r) => r.points).map((r) => r.rank), [1, 1]);
  });
  it("uses optional tieBreaker to order tied scores before falling back to name", () => {
    const tiedRows = [
      row("Adam", 0, 100, { approved_days: 0 }),
      row("Zara", 0, 100, { approved_days: 2 }),
    ];
    const ranked = rankRows(tiedRows, (r) => r.points, (a, b) => b.approved_days - a.approved_days);
    assert.deepEqual(ranked.map((r) => r.full_name), ["Zara", "Adam"]);
  });
  it("rows without a score are listed last, unranked", () => {
    const ranked = rankRows([row("Ann", 0, 0), row("Bob", 20)], (r) => normalizedScore(r));
    assert.deepEqual(ranked.map((r) => [r.full_name, r.rank]), [["Bob", 1], ["Ann", null]]);
  });
  it("ranks by a metric (hidden values count as no score)", () => {
    const m = "rev";
    const ranked = rankRows(
      [row("A", 0, 0, { metric_values: { rev: 900 } }), row("B", 0, 0, { metric_values: { rev: 1200 } }), row("C", 0, 0)],
      (r) => metricScore(r, m),
    );
    assert.deepEqual(ranked.map((r) => [r.full_name, r.rank]), [["B", 1], ["A", 2], ["C", null]]);
  });
});

describe("normalised points (overall board)", () => {
  it("is points as a % of the category's available points", () => {
    assert.equal(normalizedScore({ points: 200, max_points: 200 }), 100);
    assert.equal(normalizedScore({ points: 50, max_points: 200 }), 25);
    assert.equal(normalizedScore({ points: 100, max_points: 300 }), 33.3);
  });
  it("compares categories with different rule sets fairly", () => {
    const nurse = row("Nurse", 150, 300);
    const therapist = row("Therapist", 60, 100, { category: "beauty_therapist" });
    const ranked = rankRows([nurse, therapist], normalizedScore);
    assert.deepEqual(ranked.map((r) => r.full_name), ["Therapist", "Nurse"]);
  });
  it("is null when a category has no rules", () => assert.equal(normalizedScore({ points: 0, max_points: 0 }), null));
});

describe("trends", () => {
  it("percentage change", () => {
    assert.equal(percentChange(120, 100), 20);
    assert.equal(percentChange(75, 100), -25);
    assert.equal(percentChange(100, 100), 0);
  });
  it("no change when there is nothing to compare", () => {
    assert.equal(percentChange(100, 0), null);
    assert.equal(percentChange(null, 100), null);
    assert.equal(percentChange(100, undefined), null);
  });
});

describe("period navigation", () => {
  it("shifts weeks (Monday–Sunday)", () => {
    assert.equal(shiftPeriod("weekly", "2026-11-04", -1), "2026-10-26");
    assert.equal(shiftPeriod("weekly", "2026-11-04", 1), "2026-11-09");
    assert.equal(shiftPeriod("weekly", "2026-11-04", 0), "2026-11-02");
  });
  it("shifts months across a year end and short months", () => {
    assert.equal(shiftPeriod("monthly", "2026-01-31", -1), "2025-12-01");
    assert.equal(shiftPeriod("monthly", "2026-01-31", 1), "2026-02-01");
  });
  it("lists the last N periods, oldest first", () => {
    assert.deepEqual(recentPeriods("daily", "2026-03-01", 3), ["2026-02-27", "2026-02-28", "2026-03-01"]);
    assert.deepEqual(recentPeriods("monthly", "2026-11-04", 2), ["2026-10-01", "2026-11-01"]);
  });
  it("days between and chart labels", () => {
    assert.equal(daysBetween("2026-10-30", "2026-11-02"), 3);
    assert.equal(formatBucket("weekly", "2026-11-02"), "2 Nov");
    assert.equal(formatBucket("monthly", "2026-11-01"), "Nov 2026");
  });
});

describe("review decisions", () => {
  const id = "3f1c2a9e-1b2c-4d5e-8f90-1234567890ab";
  it("approve needs no note", () => assert.ok(reviewSchema.safeParse({ entry_id: id, decision: "approve", note: "" }).success));
  it("reject and request correction need a reason", () => {
    for (const decision of ["reject", "correction"]) {
      const result = reviewSchema.safeParse({ entry_id: id, decision, note: " " });
      assert.ok(!result.success);
      assert.equal(result.error.issues[0].path[0], "note");
      assert.ok(reviewSchema.safeParse({ entry_id: id, decision, note: "Tickets don't match the till" }).success);
    }
  });
  it("rejects unknown decisions, bad ids, long or binary notes", () => {
    assert.ok(!reviewSchema.safeParse({ entry_id: id, decision: "delete", note: "" }).success);
    assert.ok(!reviewSchema.safeParse({ entry_id: "1 or 1=1", decision: "approve", note: "" }).success);
    assert.ok(!reviewSchema.safeParse({ entry_id: id, decision: "reject", note: "x".repeat(501) }).success);
    assert.ok(!reviewSchema.safeParse({ entry_id: id, decision: "reject", note: "bad\u0000note" }).success);
  });
  it("keeps line breaks in notes", () => assert.ok(reviewSchema.safeParse({ entry_id: id, decision: "reject", note: "Line 1\nLine 2" }).success));
  it("status labels", () => {
    assert.equal(entryStatusLabel("rejected", true), "Rejected");
    assert.equal(entryStatusLabel("rejected", false), "Needs correction");
    assert.equal(entryStatusLabel("pending"), "Pending review");
  });
});

describe("URL filters", () => {
  const today = "2026-11-04";
  it("submission queue defaults to the pending tab, page 1", () => {
    assert.deepEqual(parseSubmissionFilters({}), { tab: "pending", category: null, employee: null, q: "", from: null, to: null, page: 1, notice: null });
  });
  it("ignores invalid values", () => {
    const f = parseSubmissionFilters({ tab: "drop", category: "Nurse;--", employee: "x", from: "2026-02-30", page: "-3" });
    assert.equal(f.tab, "pending");
    assert.equal(f.category, null);
    assert.equal(f.employee, null);
    assert.equal(f.from, null);
    assert.equal(f.page, 1);
  });
  it("caps search length", () => assert.equal(parseSubmissionFilters({ q: "a".repeat(200) }).q.length, 80));
  it("periods and dates", () => {
    assert.equal(parsePeriod({ period: "monthly" }), "monthly");
    assert.equal(parsePeriod({ period: "yearly" }), "weekly");
    assert.equal(parseDay({ date: "2030-01-01" }, today), today, "future dates fall back to today");
    assert.equal(parseDay({ date: "2026-10-01" }, today), "2026-10-01");
  });
  it("report range defaults to the last 30 days", () => {
    assert.deepEqual(parseReportFilters({}, today), { from: "2026-10-06", to: today, category: null, employee: null, notice: null });
  });
  it("report range is capped at a year and never in the future", () => {
    const f = parseReportFilters({ from: "2020-01-01", to: "2031-01-01" }, today);
    assert.equal(f.to, today);
    assert.equal(daysBetween(f.from, f.to), 365);
  });
  it("a start after the end falls back to the default", () => {
    assert.equal(parseReportFilters({ from: "2026-11-03", to: "2026-11-01" }, today).from, "2026-10-03");
  });
});

function metric(id: string, over: Partial<MetricDefinition> = {}): MetricDefinition {
  return {
    id, category: "nurse", key: id, name: id, description: null, kind: "input", data_type: "decimal", unit: null,
    aggregation: "sum", is_required: false, min_value: 0, max_value: null, counts_as_unit: false,
    numerator_metric_id: null, numerator_is_unit_total: false, denominator_metric_id: null, default_target: null,
    is_goal_eligible: false, is_scoring_eligible: false, sort_order: 0, is_active: true, created_at: "", updated_at: "",
    ...over,
  };
}
const series = (employee_id: string, metric_id: string, value: number | null, entries_counted: number): MetricSeriesRow => ({
  bucket: "2026-10-01", employee_id, metric_id, value, entries_counted,
});
const goal = (employee_id: string, period_end: string, target_value: number, verified_value: number | null) =>
  ({ employee_id, period_end, target_value, verified_value }) as GoalProgress;

describe("report summaries", () => {
  const metrics = [metric("hours", { is_required: true }), metric("revenue", { is_scoring_eligible: true }), metric("hourly", { kind: "calculated" })];
  const people = [
    { id: "a", full_name: "Ada", email: "a@x", employee_category: "nurse", is_active: true },
    { id: "b", full_name: "Bea", email: "b@x", employee_category: "nurse", is_active: true },
    { id: "c", full_name: "Cat", email: "c@x", employee_category: "nurse", is_active: true },
  ];
  const rows = [
    series("a", "hours", 40, 5), series("a", "revenue", 5000, 4), series("a", "hourly", 125, 5),
    series("b", "hours", 20, 3), series("b", "revenue", 3000, 3), series("b", "hourly", 150, 3),
  ];
  const goals = [goal("a", "2026-10-31", 4000, 5000), goal("a", "2026-10-31", 6000, 5000), goal("b", "2026-11-08", 100, 500)];
  const summaries = summariseEmployees(people, rows, metrics, goals, "2026-11-04");

  it("approved days come from input metrics", () => {
    assert.deepEqual(summaries.map((s) => s.approvedDays), [5, 3, 0]);
  });
  it("only finished goals count towards achievement", () => {
    assert.deepEqual(summaries.map((s) => [s.goalsAchieved, s.goalsCompleted]), [[1, 2], [0, 0], [0, 0]]);
    assert.equal(rate(1, 2), 50);
    assert.equal(rate(0, 0), null);
  });
  it("a goal is achieved on approved (verified) values only", () => {
    assert.ok(isAchieved({ target_value: 100, verified_value: 100 }));
    assert.ok(!isAchieved({ target_value: 100, verified_value: null }));
  });
  it("top performers by the lead (first scoring) metric, people without data left out", () => {
    assert.equal(leadMetric(metrics)?.id, "revenue");
    assert.deepEqual(topPerformers(summaries, "revenue").map((s) => s.employee.full_name), ["Ada", "Bea"]);
  });
  it("team average per employee with data, and the best result", () => {
    const t = teamStats(summaries, "hourly");
    assert.equal(t.average, 137.5);
    assert.equal(t.best?.employee.full_name, "Bea");
    assert.equal(teamStats(summaries, "unknown").average, null);
  });
  it("submission chart fills empty days", () => {
    const { weekly, buckets } = submissionBuckets(
      [{ day: "2026-11-02", submitted: 3, approved: 2, pending: 1, rejected: 0 }],
      "2026-11-01",
      "2026-11-03",
    );
    assert.equal(weekly, false);
    assert.deepEqual(buckets.map((b) => [b.label, b.approved, b.pending]), [["1 Nov", 0, 0], ["2 Nov", 2, 1], ["3 Nov", 0, 0]]);
  });
  it("submission chart switches to weeks for long ranges", () => {
    const { weekly, buckets } = submissionBuckets(
      [
        { day: "2026-09-01", submitted: 1, approved: 1, pending: 0, rejected: 0 },
        { day: "2026-09-02", submitted: 2, approved: 1, pending: 0, rejected: 1 },
      ],
      "2026-08-01",
      "2026-11-01",
    );
    assert.ok(weekly);
    const week = buckets.find((b) => b.label === "31 Aug");
    assert.deepEqual([week?.approved, week?.rejected], [2, 1]);
  });
});

describe("CSV export", () => {
  it("quotes commas, quotes and line breaks", () => {
    assert.equal(csvCell('Smith, "Jo"'), '"Smith, ""Jo"""');
    assert.equal(csvCell("Line 1\nLine 2"), '"Line 1\nLine 2"');
  });
  it("neutralises spreadsheet formulas (CSV injection)", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1"]) {
      assert.ok(csvCell(evil).replace(/^"/, "").startsWith("'"), evil);
    }
  });
  it("keeps numbers as numbers (including negatives)", () => {
    assert.equal(csvCell(-12.5), "-12.5");
    assert.equal(csvCell(2000), "2000");
    assert.equal(csvCell(Number.NaN), "");
  });
  it("empty cells, BOM and CRLF rows", () => {
    const csv = toCsv([["Name", "Revenue"], ["Ada", null]]);
    assert.ok(csv.startsWith("﻿"));
    assert.equal(csv.slice(1), "Name,Revenue\r\nAda,\r\n");
  });
});
