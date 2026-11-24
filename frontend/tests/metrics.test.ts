/**
 * Phase 2 logic: calculations, validation, periods, points preview, formatting.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, formatPeriod, isIsoDate, nextPeriodStart, periodEnd, periodStart, todayIn } from "../src/lib/metrics/periods.ts";
import { estimateGoalPoints } from "../src/lib/metrics/points.ts";
import { goalSchema, metricKeyFromName, metricSchema, readMetric } from "../src/lib/metrics/schemas.ts";
import { calculateValues, formatMetricValue, parseEntryValues } from "../src/lib/metrics/values.ts";
import type { MetricDefinition, ScoringRule } from "../src/types/database.ts";

function metric(id: string, over: Partial<MetricDefinition> = {}): MetricDefinition {
  return {
    id, category: "nurse", key: id, name: id, description: null, kind: "input", data_type: "decimal", unit: null,
    aggregation: "sum", is_required: false, min_value: 0, max_value: null, counts_as_unit: false,
    numerator_metric_id: null, numerator_is_unit_total: false, denominator_metric_id: null, default_target: null,
    is_goal_eligible: false, is_scoring_eligible: false, sort_order: 0, is_active: true, created_at: "", updated_at: "",
    ...over,
  };
}

// The seeded Nurse form.
const nurse = [
  metric("hours", { is_required: true, max_value: 24 }),
  metric("revenue", { is_required: true, data_type: "currency", unit: "$" }),
  metric("rebooking", { is_required: true, data_type: "percentage", max_value: 100 }),
  metric("tickets", { is_required: true, data_type: "integer" }),
  metric("filler", { counts_as_unit: true }),
  metric("sculptra", { data_type: "integer", counts_as_unit: true }),
  metric("prp", { data_type: "integer", counts_as_unit: true }),
  metric("hourly", { kind: "calculated", numerator_metric_id: "revenue", denominator_metric_id: "hours" }),
  metric("per_ticket", { kind: "calculated", numerator_metric_id: "revenue", denominator_metric_id: "tickets" }),
  metric("units_hour", { kind: "calculated", numerator_is_unit_total: true, denominator_metric_id: "hours" }),
];
const inputs = nurse.filter((m) => m.kind === "input");

describe("calculations", () => {
  it("computes hourly revenue, revenue per ticket and units per hour", () => {
    const r = calculateValues(nurse, { hours: 8, revenue: 2000, tickets: 5, filler: 2, sculptra: 1, prp: 1 });
    assert.deepEqual(r, { hourly: 250, per_ticket: 400, units_hour: 0.5 });
  });
  it("handles division by zero and missing inputs without errors", () => {
    const r = calculateValues(nurse, { hours: 0, revenue: 2000, tickets: 0 });
    assert.deepEqual(r, { hourly: null, per_ticket: null, units_hour: null });
    assert.equal(calculateValues(nurse, { hours: 8 }).hourly, null);
  });
  it("treats no treatments as 0 units", () => {
    assert.equal(calculateValues(nurse, { hours: 8 }).units_hour, 0);
  });
  it("only counts metrics marked as units (configurable)", () => {
    const configured = nurse.map((m) => (m.id === "filler" ? { ...m, counts_as_unit: false } : m));
    assert.equal(calculateValues(configured, { hours: 8, filler: 2, sculptra: 1, prp: 1 }).units_hour, 0.25);
  });
  it("rounds to 4 decimal places", () => {
    assert.equal(calculateValues(nurse, { hours: 3, revenue: 1000 }).hourly, 333.3333);
  });
});

describe("entry validation", () => {
  const raw = { hours: "8", revenue: "2,000.50", rebooking: "75", tickets: "5", filler: "", sculptra: "", prp: "" };
  it("accepts valid values and strips thousands separators", () => {
    const r = parseEntryValues(inputs, raw, { submitting: true });
    assert.deepEqual(r.errors, {});
    assert.equal(r.values.revenue, 2000.5);
    assert.deepEqual(r.cleared, ["filler", "sculptra", "prp"]);
  });
  it("requires required fields only when submitting", () => {
    assert.equal(parseEntryValues(inputs, { ...raw, hours: "" }, { submitting: false }).errors.hours, undefined);
    assert.equal(parseEntryValues(inputs, { ...raw, hours: "" }, { submitting: true }).errors.hours, "Required");
  });
  it("rejects 0 tickets when revenue is greater than 0 on submit", () => {
    const invalid = parseEntryValues(inputs, { ...raw, revenue: "22", tickets: "0" }, { submitting: true });
    assert.equal(invalid.errors.tickets, "Must be at least 1 when revenue is recorded");

    // Allows 0 tickets if revenue is 0 (training/admin day)
    const validZeroRev = parseEntryValues(inputs, { ...raw, revenue: "0", tickets: "0" }, { submitting: true });
    assert.equal(validZeroRev.errors.tickets, undefined);

    // Allows saving draft with revenue > 0 and tickets 0
    const draft = parseEntryValues(inputs, { ...raw, revenue: "22", tickets: "0" }, { submitting: false });
    assert.equal(draft.errors.tickets, undefined);
  });
  for (const [field, value, message] of [
    ["hours", "abc", "Enter a number"],
    ["hours", "1e3", "Enter a number"],
    ["hours", "25", "Must be at most 24"],
    ["revenue", "-5", "Must be at least 0"],
    ["tickets", "2.5", "Enter a whole number"],
    ["rebooking", "101", "Must be at most 100"],
    ["filler", "1.23456", "Use at most 4 decimal places"],
    ["revenue", "99999999999", "Number is too large"],
  ] as const) {
    it(`${field}=${value} → ${message}`, () => {
      assert.equal(parseEntryValues(inputs, { ...raw, [field]: value }, { submitting: false }).errors[field], message);
    });
  }
});

describe("periods (weeks run Monday–Sunday)", () => {
  it("computes period ranges", () => {
    assert.equal(periodStart("weekly", "2026-11-04"), "2026-11-02"); // Wednesday → Monday
    assert.equal(periodStart("weekly", "2026-11-08"), "2026-11-02"); // Sunday → Monday
    assert.equal(periodEnd("weekly", "2026-11-02"), "2026-11-08");
    assert.equal(periodStart("monthly", "2026-02-17"), "2026-02-01");
    assert.equal(periodEnd("monthly", "2028-02-01"), "2028-02-29"); // leap year
    assert.equal(nextPeriodStart("monthly", "2026-12-15"), "2027-01-01");
    assert.equal(nextPeriodStart("daily", "2026-12-31"), "2027-01-01");
    assert.equal(addDays("2026-03-28", 2), "2026-03-30"); // across UK clock change
  });
  it("validates ISO dates", () => {
    assert.ok(isIsoDate("2026-11-04"));
    for (const bad of ["2026-02-30", "04/11/2026", "2026-1-4", "", undefined]) assert.ok(!isIsoDate(bad));
  });
  it("uses the business time zone for today", () => {
    const lateEvening = new Date("2026-11-04T23:30:00Z");
    assert.equal(todayIn("Europe/London", lateEvening), "2026-11-04");
    assert.equal(todayIn("Australia/Sydney", lateEvening), "2026-11-05");
  });
  it("formats periods", () => {
    assert.equal(formatPeriod("weekly", "2026-11-02", "2026-11-08"), "2 Nov – 8 Nov");
    assert.equal(formatPeriod("monthly", "2026-11-01", "2026-11-30"), "November 2026");
  });
});

describe("points preview", () => {
  const rule = (threshold: number, points: number, over: Partial<ScoringRule> = {}): ScoringRule => ({
    id: `${threshold}`, metric_id: "rebooking", period: "daily", threshold, points, is_active: true, created_at: "", updated_at: "", ...over,
  });
  const rules = [rule(80, 100), rule(90, 150), rule(70, 999, { is_active: false }), rule(50, 999, { period: "weekly" })];

  it("awards the highest tier the target reaches", () => {
    assert.deepEqual(estimateGoalPoints(rules, "rebooking", "daily", 85), { points: 100, next: { threshold: 90, points: 150 } });
    assert.deepEqual(estimateGoalPoints(rules, "rebooking", "daily", 95), { points: 150, next: null });
  });
  it("gives no points for a target below the threshold (easy goals earn nothing)", () => {
    assert.deepEqual(estimateGoalPoints(rules, "rebooking", "daily", 60), { points: 0, next: { threshold: 80, points: 100 } });
  });
  it("ignores disabled rules, other periods and other metrics", () => {
    assert.equal(estimateGoalPoints(rules, "rebooking", "daily", 75).points, 0);
    assert.equal(estimateGoalPoints(rules, "revenue", "daily", 1000).points, 0);
  });
});

describe("formatting", () => {
  it("formats by type and unit", () => {
    assert.equal(formatMetricValue(2000, "currency", "$"), "$2,000.00");
    assert.equal(formatMetricValue(250, "currency", "$/h"), "$250.00/h");
    assert.equal(formatMetricValue(80, "percentage", "%"), "80%");
    assert.equal(formatMetricValue(0.375, "decimal", "units/h"), "0.38 units/h");
    assert.equal(formatMetricValue(5, "integer", null), "5");
    assert.equal(formatMetricValue(null, "currency", "$"), "—");
    assert.equal(formatMetricValue(1, "integer", "treatments"), "1 treatment");
    assert.equal(formatMetricValue(3, "integer", "treatments"), "3 treatments");
    assert.equal(formatMetricValue(1, "integer", "tickets"), "1 ticket");
    assert.equal(formatMetricValue(4, "integer", "tickets"), "4 tickets");
  });
});

describe("admin forms", () => {
  it("derives stable metric keys", () => {
    assert.equal(metricKeyFromName("Rebooking %"), "rebooking_pct");
    assert.equal(metricKeyFromName("Filler/ML"), "filler_ml");
    assert.equal(metricKeyFromName("3D Facials"), "m_3d_facials");
  });
  it("validates metric definitions", () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ category: "beauty_therapist", name: "Facials", data_type: "integer", min_value: "10", max_value: "5" }))
      fd.set(k, v);
    const r = metricSchema.safeParse(readMetric(fd));
    assert.ok(!r.success && r.error.issues.some((i) => i.path[0] === "max_value"));
  });
  it("validates goals", () => {
    const ok = { metric_id: "6f1d8a2e-1c3b-4b8e-9a5d-2f7e6c1b0a9d", period: "weekly", when: "current", target_value: "600" };
    assert.ok(goalSchema.safeParse(ok).success);
    assert.ok(!goalSchema.safeParse({ ...ok, target_value: "0" }).success);
    assert.ok(!goalSchema.safeParse({ ...ok, target_value: "-5" }).success);
    assert.ok(!goalSchema.safeParse({ ...ok, period: "yearly" }).success);
  });
});
