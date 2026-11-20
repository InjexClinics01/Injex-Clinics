import type { AppRole } from "@/types/database";

/** Pages for signed-out users. Signed-in users are redirected to their home. */
const GUEST_ONLY_PATHS = ["/login", "/forgot-password", "/signup"] as const;

/**
 * Always reachable: email-link callbacks, and the reset page (which itself
 * explains an expired link when there is no recovery session).
 */
const PUBLIC_PREFIXES = ["/auth/", "/reset-password"] as const;

const ADMIN_PREFIX = "/admin";
const EMPLOYEE_PREFIX = "/employee";

export function homeForRole(role: AppRole) {
  return role === "admin" ? "/admin" : "/employee";
}

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isGuestOnlyPath(pathname: string) {
  return GUEST_ONLY_PATHS.some((p) => matchesPrefix(pathname, p));
}

export function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Only allow same-origin relative redirects ("/admin/employees"), never
 * "//evil.com" or "https://evil.com" (open-redirect protection).
 */
export function safeRedirectPath(value: unknown, fallback = "/dashboard") {
  if (typeof value !== "string" || value.length > 2048) return fallback;
  // Browsers silently strip tabs/newlines and treat "\" as "/", so "/\t/evil.com"
  // or "/\evil.com" would become "//evil.com". Reject them outright.
  if (/[\u0000-\u001F\u007F\\]/.test(value)) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const base = "http://same-origin.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * Sections whose layouts check the role and active status themselves
 * (requireAdmin / requireEmployee / requireUser), so the proxy needs no profile lookup.
 */
export function isLayoutGuardedPath(pathname: string) {
  return [ADMIN_PREFIX, EMPLOYEE_PREFIX, "/profile"].some((p) => matchesPrefix(pathname, p));
}

/** Is this role allowed to open this path? (UI routing; RLS protects data.) */
export function canAccessPath(role: AppRole, pathname: string) {
  if (matchesPrefix(pathname, ADMIN_PREFIX)) return role === "admin";
  if (matchesPrefix(pathname, EMPLOYEE_PREFIX)) return role === "employee";
  return true;
}
