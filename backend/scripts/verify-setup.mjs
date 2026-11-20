#!/usr/bin/env node
/**
 * Read-only check of the live Supabase project after setup.
 * Usage (from backend/):  node scripts/verify-setup.mjs
 *
 * Reads backend/.env (SUPABASE_URL, SUPABASE_SECRET_KEY) and frontend/.env /
 * frontend/.env.local (publishable key). Never prints key values. Changes nothing.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const f of ["frontend/.env", "frontend/.env.local", "backend/.env"]) {
  const p = join(root, f);
  if (existsSync(p)) process.loadEnvFile(p); // later files override earlier ones
}

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const secret = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const publishable = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg, fix) => {
  failures++;
  console.log(`  ✗ ${msg}${fix ? `\n      → ${fix}` : ""}`);
};
const warn = (msg) => console.log(`  ! ${msg}`);

const kind = (k) =>
  !k ? "missing" : k.startsWith("sb_publishable_") ? "publishable" : k.startsWith("sb_secret_") ? "secret" : k.startsWith("eyJ") ? "legacy JWT" : "unknown";
function jwtRole(k) {
  try {
    return JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString()).role;
  } catch {
    return undefined;
  }
}
/** New sb_ keys go only in `apikey`; legacy JWT keys also in Authorization. */
const headers = (k) => ({ apikey: k, ...(k.startsWith("eyJ") ? { Authorization: `Bearer ${k}` } : {}) });
async function get(path, key) {
  let res;
  try {
    res = await fetch(`${url}${path}`, { headers: headers(key), signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return { status: 0, body: { message: e.name === "TimeoutError" ? "request timed out after 15s" : e.message } };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

console.log(`\nSupabase project: ${url || "(not set)"}\n`);

console.log("Configuration");
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) bad("SUPABASE_URL is not a Supabase project URL", "Set it in backend/.env");
else ok("Project URL set");
const pk = kind(publishable);
if (pk === "publishable") ok("Publishable key (sb_publishable_…)");
else if (pk === "legacy JWT" && jwtRole(publishable) === "anon") warn("Legacy anon key in use (works; switch to sb_publishable_… when convenient)");
else bad(`Public key is ${pk}${pk === "legacy JWT" ? ` with role "${jwtRole(publishable)}"` : ""}`, "Use the publishable key in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const sk = kind(secret);
if (sk === "secret") ok("Secret key (sb_secret_…)");
else if (sk === "legacy JWT" && jwtRole(secret) === "service_role") warn("Legacy service_role key in use (works; switch to sb_secret_… when convenient)");
else bad(`Secret key is ${sk}${sk === "legacy JWT" ? ` with role "${jwtRole(secret)}"` : ""}`, "Put the secret key (sb_secret_…) in SUPABASE_SECRET_KEY");
const zone = process.env.NEXT_PUBLIC_APP_TIME_ZONE;
if (zone && zone !== "Europe/London") {
  warn(`NEXT_PUBLIC_APP_TIME_ZONE is ${zone}, but the database uses Europe/London for "today" (private.app_today()). They must match.`);
}
if (failures) process.exit(1);

console.log("\nAuthentication");
const settings = await get("/auth/v1/settings", publishable);
if (settings.status !== 200) bad(`Auth settings returned HTTP ${settings.status}`, "Check the publishable key");
else {
  ok("Publishable key accepted");
  if (settings.body.disable_signup) ok("Public sign-up is disabled");
  else bad("Public sign-up is ENABLED (anyone could register)", "Authentication → Sign In / Providers → turn off “Allow new users to sign up”, then Save");
  if (settings.body.external?.email) ok("Email + password sign-in enabled");
  else bad("Email provider disabled", "Authentication → Sign In / Providers → Email → enable");
}
const users = await get("/auth/v1/admin/users?per_page=1", secret);
if (users.status === 200) ok("Secret key accepted by Auth admin API");
else bad(`Secret key rejected by Auth admin API (HTTP ${users.status})`, "Re-copy the secret key from Project Settings → API Keys");

console.log("\nDatabase (migrations)");
const cats = await get("/rest/v1/employee_categories?select=slug&order=slug", secret);
if (cats.status === 404 || cats.body?.code === "PGRST205") {
  bad("Tables not found: migrations have not been run", "Run the migrations: cd backend && npx supabase db push --remote");
} else if (cats.status !== 200) {
  bad(`employee_categories returned HTTP ${cats.status}: ${cats.body?.message ?? ""}`);
} else {
  const slugs = cats.body.map((c) => c.slug);
  ok("Tables exist: employee_categories, profiles, audit_logs");
  if (slugs.includes("nurse") && slugs.includes("beauty_therapist")) ok(`Categories seeded: ${slugs.join(", ")}`);
  else bad(`Expected nurse + beauty_therapist, found: ${slugs.join(", ") || "none"}`);

  for (const t of ["profiles", "audit_logs"]) {
    const r = await get(`/rest/v1/${t}?select=id&limit=1`, secret);
    if (r.status !== 200) bad(`${t} returned HTTP ${r.status}: ${r.body?.message ?? ""}`);
  }

  // Logged-out access must be denied.
  for (const t of ["profiles", "employee_categories", "audit_logs"]) {
    const r = await get(`/rest/v1/${t}?select=*&limit=1`, publishable);
    if (r.status === 401 || r.status === 403 || r.body?.code === "42501") ok(`Logged-out users blocked from ${t}`);
    else if (Array.isArray(r.body) && r.body.length === 0) bad(`${t} readable by logged-out users (0 rows returned, but access should be denied)`, "Re-run the migrations: npx supabase db push --remote");
    else bad(`${t} is READABLE by logged-out users`, "Re-run the migrations (RLS/grants missing): npx supabase db push --remote");
  }

  const admins = await get("/rest/v1/profiles?select=id&role=eq.admin&is_active=eq.true", secret);
  const n = Array.isArray(admins.body) ? admins.body.length : 0;
  if (n > 0) ok(`${n} active administrator account(s)`);
  else warn('No administrator yet → node scripts/create-admin.mjs --email you@example.com --name "Your Name"');

  // Later phases: each migration adds tables. Missing ones mean that migration has not been pushed yet.
  console.log("\nDatabase (later phases)");
  const phases = [
    { name: "Phase 2 (metrics, goals)", tables: ["metric_definitions", "metric_entries", "metric_entry_values", "goals", "scoring_rules"] },
    { name: "Phase 3 (verification, leaderboard)", tables: ["app_settings"] },
    { name: "Phase 4 (points, rewards)", tables: ["points_transactions", "points_settlements", "rewards", "reward_redemptions"] },
  ];
  // A network failure (status 0) is reported as such, never as "reachable".
  const describe = (r) => (r.status === 0 ? `could not be checked (${r.body?.message})` : `returned HTTP ${r.status}: ${r.body?.message ?? ""}`);
  for (const phase of phases) {
    const before = failures;
    const missing = [];
    for (const t of phase.tables) {
      const r = await get(`/rest/v1/${t}?select=id&limit=1`, secret);
      if (r.status === 404 || r.body?.code === "PGRST205") missing.push(t);
      else if (r.status !== 200) bad(`${t} ${describe(r)}`);
      else {
        const anon = await get(`/rest/v1/${t}?select=id&limit=1`, publishable);
        if (anon.status === 401 || anon.status === 403 || anon.body?.code === "42501") continue;
        if (anon.status === 0) bad(`${t}: logged-out access ${describe(anon)}`, "Network problem: run the check again");
        else bad(`${t} is READABLE by logged-out users (HTTP ${anon.status})`, "Re-run the migrations: npx supabase db push --remote");
      }
    }
    if (missing.length) bad(`${phase.name}: not applied (missing ${missing.join(", ")})`, "cd backend && npx supabase db push --remote");
    else if (failures === before) ok(`${phase.name}: tables present, logged-out access blocked`);
  }
}

console.log(failures ? `\n${failures} problem(s) found.\n` : "\nAll checks passed.\n");
process.exit(failures ? 1 : 0);
