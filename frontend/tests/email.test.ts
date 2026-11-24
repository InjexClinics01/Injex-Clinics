import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generatePasswordResetEmail } from "../src/lib/email/templates/password-reset.ts";
import {
  generateRegistrationApprovedEmail,
  generateRegistrationRejectedEmail,
} from "../src/lib/email/templates/registration-decision.ts";
import { isResendConfigured, getDefaultFromEmail } from "../src/lib/email/resend.ts";

describe("email templates & resend helper", () => {
  it("generates personalized password reset email", () => {
    const email = generatePasswordResetEmail({
      recipientName: "Dr. Sarah",
      resetUrl: "http://localhost:3000/auth/confirm?token_hash=abc&type=recovery",
    });

    assert.equal(email.subject, "Reset your Injex Clinics password");
    assert.match(email.html, /Hello Dr\. Sarah,/);
    assert.match(email.html, /href="http:\/\/localhost:3000\/auth\/confirm\?token_hash=abc&type=recovery"/);
    assert.match(email.text, /Hello Dr\. Sarah,/);
    assert.match(email.text, /http:\/\/localhost:3000\/auth\/confirm\?token_hash=abc&type=recovery/);
  });

  it("generates generic password reset email when name is missing", () => {
    const email = generatePasswordResetEmail({
      resetUrl: "http://localhost:3000/auth/confirm?token_hash=xyz&type=recovery",
    });

    assert.match(email.html, /Hello,/);
    assert.match(email.text, /Hello,/);
  });

  it("checks resend configuration status gracefully", () => {
    // Should return a boolean without throwing
    const configured = isResendConfigured();
    assert.equal(typeof configured, "boolean");

    const defaultFrom = getDefaultFromEmail();
    assert.match(defaultFrom, /@/);
  });

  it("generates registration approved email", () => {
    const email = generateRegistrationApprovedEmail({
      recipientName: "Nurse Sarah",
      category: "nurse",
      loginUrl: "http://localhost:3000/login",
    });

    assert.equal(email.subject, "Welcome to Injex Clinics — Your account has been approved");
    assert.match(email.html, /Hello Nurse Sarah,/);
    assert.match(email.html, /Nurse/);
    assert.match(email.html, /href="http:\/\/localhost:3000\/login"/);
    assert.match(email.text, /Hello Nurse Sarah,/);
    assert.match(email.text, /http:\/\/localhost:3000\/login/);
  });

  it("generates registration rejected email with reason", () => {
    const email = generateRegistrationRejectedEmail({
      recipientName: "John Doe",
      reason: "Could not verify medical license details.",
    });

    assert.equal(email.subject, "Update regarding your Injex Clinics registration request");
    assert.match(email.html, /Hello John Doe,/);
    assert.match(email.html, /Could not verify medical license details\./);
    assert.match(email.text, /Reason: Could not verify medical license details\./);
  });

  it("generates registration rejected email without reason", () => {
    const email = generateRegistrationRejectedEmail({
      recipientName: "John Doe",
    });

    assert.match(email.html, /Hello John Doe,/);
    assert.doesNotMatch(email.html, /Note from administrator:/);
    assert.doesNotMatch(email.text, /Reason:/);
  });
});
