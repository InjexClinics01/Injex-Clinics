import type { CookieOptions } from "@supabase/ssr";

/**
 * "Keep me signed in" support.
 *
 * Supabase stores the session in cookies that last 400 days by default. When a
 * user signs in WITHOUT "keep me signed in", we set REMEMBER_COOKIE=0 and every
 * Supabase client strips maxAge/expires from the auth cookies it writes, turning
 * them into browser-session cookies that are cleared when the browser closes.
 *
 * With "keep me signed in", the lifetime is capped at 30 days. Session cookies
 * are rewritten whenever the token refreshes, so this is a sliding idle limit:
 * someone who is away for 30 days has to sign in again.
 */
export const REMEMBER_COOKIE = "spd-remember";
export const REMEMBER_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function shouldPersist(rememberValue: string | undefined | null) {
  return rememberValue !== "0";
}

export function applySessionPolicy(options: CookieOptions, persist: boolean): CookieOptions {
  // Keep deletions (maxAge 0 / past expiry) intact; only change long lifetimes.
  const isDeletion = options.maxAge === 0 || (options.expires instanceof Date && options.expires.getTime() <= Date.now());
  if (isDeletion) return options;
  const rest = { ...options };
  delete rest.maxAge;
  delete rest.expires;
  return persist ? { ...rest, maxAge: REMEMBER_MAX_AGE_SECONDS } : rest;
}
