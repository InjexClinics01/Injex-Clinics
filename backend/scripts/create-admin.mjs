#!/usr/bin/env node
/**
 * Bootstrap an administrator account (needed once: public sign-up is disabled,
 * so the first admin cannot be created from the app).
 *
 * Usage (from backend/):
 *   node scripts/create-admin.mjs --email kate@example.com --name "Kate Taylor" [--password "..."]
 *   node scripts/create-admin.mjs --email existing@user.com     # promote an existing account
 *
 * Reads SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_…) from backend/.env.
 * The legacy SUPABASE_SERVICE_ROLE_KEY (JWT) is still accepted as a fallback.
 * If --password is omitted a strong temporary password is generated and printed once.
 * No dependencies: talks to the Supabase Auth Admin REST API directly.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    password: { type: "string" },
  },
});

const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!url || !key || /your-project-ref|^your[-_]/.test(url + " " + key)) {
  fail("Set SUPABASE_URL and SUPABASE_SECRET_KEY in backend/.env (see backend/.env.example).");
}
if (key.startsWith("sb_publishable_")) fail("SUPABASE_SECRET_KEY contains a publishable key. Use the secret key (sb_secret_…).");
if (!values.email) fail('Usage: node scripts/create-admin.mjs --email you@example.com --name "Full Name" [--password ...]');

const email = values.email.trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`"${values.email}" is not a valid email address.`);

/**
 * New keys (sb_secret_…) are not JWTs: send them ONLY in the `apikey` header.
 * Legacy service_role keys are JWTs and also go in `Authorization: Bearer`.
 */
function authHeaders(apiKey) {
  const headers = { apikey: apiKey, "Content-Type": "application/json" };
  if (apiKey.startsWith("eyJ")) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function api(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { ...authHeaders(key), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    fail(`${method} ${path.split("?")[0]} → HTTP ${res.status}: ${data.msg ?? data.message ?? data.error_description ?? JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Make the profile an active admin. Done explicitly because Supabase Auth
 * inserts the user BEFORE saving app_metadata, so the profile trigger cannot
 * see the role at creation time. (The secret key bypasses RLS; the database
 * still guarantees at least one active admin.)
 */
async function promoteProfile(userId) {
  const rows = await api("PATCH", `/rest/v1/profiles?id=eq.${userId}`, { role: "admin", employee_category: null, is_active: true }, {
    Prefer: "return=representation",
  });
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].role !== "admin") fail("Profile row not found. Have the migrations been run? (npx supabase db push --remote)");
  // Keep Auth metadata consistent with the profile.
  await api("PUT", `/auth/v1/admin/users/${userId}`, { app_metadata: { role: "admin" }, ban_duration: "none" });
}

const existing = await api("GET", `/rest/v1/profiles?select=id,role,is_active,full_name&email=eq.${encodeURIComponent(email)}`);

if (existing.length === 1) {
  const p = existing[0];
  if (p.role === "admin" && p.is_active) {
    console.log(`✓ ${email} is already an active administrator. Nothing to do.`);
    process.exit(0);
  }
  await promoteProfile(p.id);
  console.log(`✓ Existing account ${email} promoted to administrator (was: ${p.role}${p.is_active ? "" : ", inactive"}).`);
  console.log("tTheir password is unchanged.");
  process.exit(0);
}

if (!values.name) fail('No account exists for this email yet. To create one, also pass --name "Full Name".');
const generated = !values.password;
const password = values.password ?? `${randomBytes(12).toString("base64url")}9a`;
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  fail("Password must be at least 8 characters and contain a letter and a number.");
}

const created = await api("POST", "/auth/v1/admin/users", {
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: values.name.trim() },
  app_metadata: { role: "admin" },
});
await promoteProfile(created.id);

console.log(`✓ Admin account created: ${email} (id ${created.id})`);
if (generated) {
  console.log(`  Temporary password: ${password}`);
  console.log("  Sign in and change it from My profile → Change password.");
}
