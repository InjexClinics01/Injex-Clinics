/**
 * Phase 4 logic: points formatting, redeem eligibility, reward / adjustment /
 * redemption / settings validation, and safe database error messages.
 * (Crediting, balances and redemptions themselves are tested in the database:
 * backend/supabase/tests/phase4_points_test.sql.)
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adjustmentSchema,
  formatPoints,
  pointsSettingsSchema,
  redeemBlocker,
  redemptionDecisionSchema,
  rewardSchema,
  totalPendingPoints,
} from "../src/lib/points/schemas.ts";
import { rpcErrorMessage } from "../src/lib/supabase/rpc-error.ts";

const id = "3f1c2a9e-1b2c-4d5e-8f90-1234567890ab";

describe("points formatting", () => {
  it("formats with separators and signs", () => {
    assert.equal(formatPoints(1250), "1,250");
    assert.equal(formatPoints(-50), "−50");
    assert.equal(formatPoints(120, true), "+120");
    assert.equal(formatPoints(-20, true), "−20");
    assert.equal(formatPoints(0, true), "0");
  });
  it("sums pending awards", () => assert.equal(totalPendingPoints([{ points: 10 }, { points: 50 }]), 60));
});

describe("can a reward be redeemed?", () => {
  const reward = { points_cost: 100, stock: 3 as number | null, is_active: true };
  it("yes, with enough points and stock", () => assert.equal(redeemBlocker(reward, 100, false), null));
  it("not without enough points (says how many more)", () => assert.equal(redeemBlocker(reward, 40, false), "60 more points needed"));
  it("not when out of stock", () => assert.equal(redeemBlocker({ ...reward, stock: 0 }, 500, false), "Out of stock"));
  it("unlimited stock is fine", () => assert.equal(redeemBlocker({ ...reward, stock: null }, 500, false), null));
  it("not twice while a request is waiting", () => assert.equal(redeemBlocker(reward, 500, true), "Request waiting for approval"));
  it("not when inactive", () => assert.equal(redeemBlocker({ ...reward, is_active: false }, 500, false), "No longer available"));
});

describe("reward form", () => {
  const valid = { id: "", name: "Coffee voucher", description: "", points_cost: "500", stock: "", is_active: true };
  it("accepts a reward with unlimited stock", () => {
    const r = rewardSchema.parse(valid);
    assert.equal(r.points_cost, 500);
    assert.equal(r.stock, null);
  });
  it("accepts thousands separators and zero stock", () => {
    const r = rewardSchema.parse({ ...valid, points_cost: "1,500", stock: "0" });
    assert.deepEqual([r.points_cost, r.stock], [1500, 0]);
  });
  it("rejects zero, negative or fractional points and negative stock", () => {
    for (const points_cost of ["0", "-5", "12.5", "abc", ""]) assert.ok(!rewardSchema.safeParse({ ...valid, points_cost }).success, points_cost);
    assert.ok(!rewardSchema.safeParse({ ...valid, stock: "-1" }).success);
  });
  it("rejects very short names and control characters", () => {
    assert.ok(!rewardSchema.safeParse({ ...valid, name: "A" }).success);
    assert.ok(!rewardSchema.safeParse({ ...valid, name: "Bad\u0000name" }).success);
  });
});

describe("manual adjustment", () => {
  it("needs a reason", () => {
    const r = adjustmentSchema.safeParse({ employee_id: id, amount: "50", reason: "ok" });
    assert.ok(!r.success);
    assert.equal(r.error.issues[0].path[0], "reason");
  });
  it("allows removing points, but not zero or huge amounts", () => {
    assert.equal(adjustmentSchema.parse({ employee_id: id, amount: "-20", reason: "Duplicate bonus" }).amount, -20);
    assert.ok(!adjustmentSchema.safeParse({ employee_id: id, amount: "0", reason: "Nothing at all" }).success);
    assert.ok(!adjustmentSchema.safeParse({ employee_id: id, amount: "200000", reason: "Way too much" }).success);
  });
  it("needs a valid employee", () => assert.ok(!adjustmentSchema.safeParse({ employee_id: "x", amount: "5", reason: "Valid reason" }).success));
});

describe("redemption decisions", () => {
  it("approve and fulfil need no note", () => {
    for (const decision of ["approve", "fulfil"]) assert.ok(redemptionDecisionSchema.safeParse({ redemption_id: id, decision, note: "" }).success);
  });
  it("reject and refund need a reason", () => {
    for (const decision of ["reject", "refund"]) {
      assert.ok(!redemptionDecisionSchema.safeParse({ redemption_id: id, decision, note: "" }).success);
      assert.ok(redemptionDecisionSchema.safeParse({ redemption_id: id, decision, note: "Out of stock" }).success);
    }
  });
  it("unknown decisions are refused", () => assert.ok(!redemptionDecisionSchema.safeParse({ redemption_id: id, decision: "delete", note: "" }).success));
});

describe("points settings", () => {
  const valid = { points_start_date: "2026-11-01", streak_enabled: true, streak_min_days: "4", streak_weeks: "4", streak_points: "100" };
  it("accepts sensible values", () => assert.ok(pointsSettingsSchema.safeParse(valid).success));
  it("rejects bad dates and out-of-range streaks", () => {
    assert.ok(!pointsSettingsSchema.safeParse({ ...valid, points_start_date: "2026-02-30" }).success);
    assert.ok(!pointsSettingsSchema.safeParse({ ...valid, streak_min_days: "8" }).success);
    assert.ok(!pointsSettingsSchema.safeParse({ ...valid, streak_weeks: "0" }).success);
  });
});

describe("database error messages", () => {
  it("shows our own business-rule messages", () => {
    assert.equal(
      rpcErrorMessage({ code: "P0001", message: "Not enough points: this reward needs 500, you have 120 available" }, "fallback"),
      "Not enough points: this reward needs 500, you have 120 available",
    );
  });
  it("hides Postgres internals", () => {
    assert.equal(rpcErrorMessage({ code: "42501", message: 'new row violates row-level security policy for table "x"' }, "fallback"), "fallback");
    assert.equal(rpcErrorMessage({ code: "23505", message: "duplicate key value" }, "fallback"), "fallback");
    assert.equal(rpcErrorMessage(null, "fallback"), "fallback");
  });
});
