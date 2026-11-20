/**
 * Public Supabase configuration (safe for the browser: data is protected by RLS).
 *
 * Supabase API keys (https://github.com/orgs/supabase/discussions/29260):
 *   - Publishable key `sb_publishable_…`  → replaces the legacy `anon` key
 *   - Secret key      `sb_secret_…`       → replaces the legacy `service_role` key
 *
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is preferred. The legacy variable name
 * NEXT_PUBLIC_SUPABASE_ANON_KEY (holding either key type) is still accepted.
 * NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them.
 */

const PLACEHOLDER = /^your[-_]|your-project-ref/;

function readPublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  return { url, key };
}

export function getSupabaseEnv() {
  const { url, key } = readPublicEnv();

  if (!url || !key || PLACEHOLDER.test(url) || PLACEHOLDER.test(key)) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in frontend/.env.local (see .env.example).",
    );
  }
  // A secret key in a NEXT_PUBLIC_ variable would be shipped to every browser.
  if (key.startsWith("sb_secret_")) {
    throw new Error(
      "A SECRET key (sb_secret_…) was put in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. That would expose it to browsers. Use the publishable key (sb_publishable_…) there, rotate the leaked secret key in the Supabase dashboard, and put the new one in SUPABASE_SECRET_KEY.",
    );
  }
  return { url, publishableKey: key };
}

export function isSupabaseConfigured() {
  const { url, key } = readPublicEnv();
  return Boolean(url && key && !PLACEHOLDER.test(url) && !PLACEHOLDER.test(key));
}

export type ApiKeyKind = "publishable" | "secret" | "legacy-jwt" | "unknown" | "missing";

/** Identify a Supabase key type from its prefix (never returns the key itself). */
export function apiKeyKind(key: string | undefined | null): ApiKeyKind {
  if (!key) return "missing";
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("eyJ")) return "legacy-jwt";
  return "unknown";
}

export function publicKeyKind(): ApiKeyKind {
  return apiKeyKind(readPublicEnv().key);
}
