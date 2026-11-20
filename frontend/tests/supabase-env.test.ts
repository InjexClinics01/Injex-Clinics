/**
 * Supabase key configuration (publishable / secret keys, legacy fallback).
 * Run: npm test
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { apiKeyKind, getSupabaseEnv, isSupabaseConfigured } from "../src/lib/supabase/env.ts";

const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function setEnv(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
}
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const URL = "https://abcdefghijklmnop.supabase.co";

describe("apiKeyKind", () => {
  it("recognises key formats", () => {
    assert.equal(apiKeyKind("sb_publishable_abc"), "publishable");
    assert.equal(apiKeyKind("sb_secret_abc"), "secret");
    assert.equal(apiKeyKind("eyJhbGciOiJIUzI1NiJ9.x.y"), "legacy-jwt");
    assert.equal(apiKeyKind(""), "missing");
    assert.equal(apiKeyKind(undefined), "missing");
  });
});

describe("getSupabaseEnv", () => {
  it("uses NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_new" });
    assert.deepEqual(getSupabaseEnv(), { url: URL, publishableKey: "sb_publishable_new" });
  });
  it("prefers the publishable variable over the legacy anon variable", () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_new", NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJold" });
    assert.equal(getSupabaseEnv().publishableKey, "sb_publishable_new");
  });
  it("falls back to the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY", () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJlegacy" });
    assert.equal(getSupabaseEnv().publishableKey, "eyJlegacy");
  });
  it("trims accidental whitespace", () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: ` ${URL} `, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " sb_publishable_x\n" });
    assert.deepEqual(getSupabaseEnv(), { url: URL, publishableKey: "sb_publishable_x" });
  });
  it("REFUSES a secret key in the public variable (would leak to browsers)", () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_oops" });
    assert.throws(() => getSupabaseEnv(), /SECRET key/);
  });
  it("treats missing or template placeholder values as not configured", () => {
    setEnv({});
    assert.equal(isSupabaseConfigured(), false);
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://your-project-ref.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "your-publishable-key" });
    assert.equal(isSupabaseConfigured(), false);
    assert.throws(() => getSupabaseEnv(), /not configured/);
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ok" });
    assert.equal(isSupabaseConfigured(), true);
  });
});
