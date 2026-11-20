import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import { apiKeyKind, getSupabaseEnv } from "./env";

/**
 * Read the server-only secret key.
 * Preferred: SUPABASE_SECRET_KEY (sb_secret_…). Legacy fallback: SUPABASE_SERVICE_ROLE_KEY.
 */
function readSecretKey() {
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!key || /^your[-_]/.test(key)) return undefined;
  return key;
}

/**
 * Secret-key (service_role) client. BYPASSES Row Level Security.
 *
 * - Server-only (enforced by the `server-only` import: bundling this into
 *   client code fails the build). Supabase also rejects secret keys sent from
 *   a browser with HTTP 401.
 * - Only call after verifying the caller is an admin (requireAdmin()).
 * - Used exclusively for Supabase Auth admin operations (create / invite /
 *   ban users) that cannot be performed with a user session.
 * - supabase-js sends sb_secret_ keys only in the `apikey` header (they are
 *   not JWTs), so no extra configuration is needed.
 */
export function createAdminClient() {
  const secretKey = readSecretKey();
  if (!secretKey) throw new AdminClientNotConfiguredError();
  if (secretKey.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SECRET_KEY contains a publishable key (sb_publishable_…). Use the secret key (sb_secret_…).");
  }
  const { url } = getSupabaseEnv();
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function isAdminClientConfigured() {
  const key = readSecretKey();
  return Boolean(key && !key.startsWith("sb_publishable_"));
}

export class AdminClientNotConfiguredError extends Error {
  constructor() {
    super("SUPABASE_SECRET_KEY is not set on the server. Employee account creation is unavailable.");
    this.name = "AdminClientNotConfiguredError";
  }
}

export function secretKeyKind() {
  return apiKeyKind(readSecretKey());
}
