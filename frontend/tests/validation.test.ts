/**
 * Unit tests for input validation and redirect safety.
 * Run: npm test   (Node's built-in test runner, no extra dependencies)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeRedirectPath } from "../src/lib/auth/routes.ts";
import {
  changePasswordSchema,
  emailSchema,
  fullNameSchema,
  loginSchema,
  newPasswordSchema,
  passwordSchema,
} from "../src/lib/auth/validation.ts";
import { hallOfFameSchema } from "../src/lib/hall-of-fame/schemas.ts";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe("email", () => {
  it("accepts and normalises valid emails", () => {
    assert.equal(emailSchema.parse("  Kate.Taylor@Clinic.COM "), "kate.taylor@clinic.com");
    assert.ok(ok(emailSchema, "nurse+rota@clinic.co.uk"));
  });
  for (const bad of ["", "   ", "kate", "kate@", "@clinic.com", "kate@clinic", "kate @clinic.com", "a@b..com", `${"a".repeat(250)}@x.com`]) {
    it(`rejects ${JSON.stringify(bad.slice(0, 30))}`, () => assert.ok(!ok(emailSchema, bad)));
  }
});

describe("new password", () => {
  it("accepts a valid password", () => assert.ok(ok(passwordSchema, "Clinic2026")));
  for (const [bad, why] of [
    ["Short1", "too short"],
    ["onlyletters", "no number"],
    ["12345678", "no letter"],
    [" Clinic2026", "leading space"],
    ["Clinic2026 ", "trailing space"],
    ["Clinic\n2026", "control character"],
    ["a1" + "x".repeat(71), "over 72 bytes"],
    ["é1" + "é".repeat(36), "over 72 bytes (multi-byte)"],
  ] as const) {
    it(`rejects: ${why}`, () => assert.ok(!ok(passwordSchema, bad)));
  }
  it("requires matching confirmation", () => {
    assert.ok(ok(newPasswordSchema, { password: "Clinic2026", confirmPassword: "Clinic2026" }));
    assert.ok(!ok(newPasswordSchema, { password: "Clinic2026", confirmPassword: "Clinic2027" }));
  });
  it("change password requires current and a different new password", () => {
    assert.ok(ok(changePasswordSchema, { currentPassword: "Old12345", password: "New12345", confirmPassword: "New12345" }));
    assert.ok(!ok(changePasswordSchema, { currentPassword: "", password: "New12345", confirmPassword: "New12345" }));
    assert.ok(!ok(changePasswordSchema, { currentPassword: "Same1234", password: "Same1234", confirmPassword: "Same1234" }));
  });
});

describe("login", () => {
  it("requires email and password", () => {
    assert.ok(ok(loginSchema, { email: "a@b.co", password: "x", remember: true }));
    assert.ok(!ok(loginSchema, { email: "a@b.co", password: "", remember: true }));
    assert.ok(!ok(loginSchema, { email: "nope", password: "x", remember: true }));
  });
});

describe("full name", () => {
  it("accepts real names and collapses spaces", () => {
    assert.equal(fullNameSchema.parse("  Mary-Jane   O'Neil "), "Mary-Jane O'Neil");
    assert.ok(ok(fullNameSchema, "José Álvarez"));
    assert.ok(ok(fullNameSchema, "Dr. Siobhán Ní Bhriain"));
  });
  for (const bad of ["", "A", "<script>", "Kate\u0000", "1234", "Kate Taylor!", "x".repeat(121)]) {
    it(`rejects ${JSON.stringify(bad.slice(0, 20))}`, () => assert.ok(!ok(fullNameSchema, bad)));
  }
});

describe("safeRedirectPath (open-redirect protection)", () => {
  it("keeps same-origin paths", () => {
    assert.equal(safeRedirectPath("/admin/employees?x=1"), "/admin/employees?x=1");
    assert.equal(safeRedirectPath("/reset-password?welcome=1"), "/reset-password?welcome=1");
  });
  for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "\\\\evil.com", "evil.com", "javascript:alert(1)", "", 42]) {
    it(`rejects ${JSON.stringify(bad)}`, () => assert.equal(safeRedirectPath(bad, "/fallback"), "/fallback"));
  }
});

describe("hall of fame award validation", () => {
  const valid = {
    employee_id: "123e4567-e89b-42d3-a456-426614174000",
    title: "Employee of the Month",
    award_period: "May 2026",
    citation: "Outstanding dedication and 95% rebooking rate.",
    bonus_points: "100",
  };

  it("accepts a valid award with bonus points", () => {
    assert.ok(ok(hallOfFameSchema, valid));
  });

  it("accepts an award without bonus points (empty string defaults to 0)", () => {
    const res = hallOfFameSchema.parse({ ...valid, bonus_points: "" });
    assert.equal(res.bonus_points, 0);
  });

  it("rejects invalid employee id", () => {
    assert.ok(!ok(hallOfFameSchema, { ...valid, employee_id: "not-a-uuid" }));
  });

  it("rejects too short title or citation", () => {
    assert.ok(!ok(hallOfFameSchema, { ...valid, title: "A" }));
    assert.ok(!ok(hallOfFameSchema, { ...valid, citation: "Good" }));
  });

  it("rejects negative bonus points", () => {
    assert.ok(!ok(hallOfFameSchema, { ...valid, bonus_points: "-10" }));
  });
});

