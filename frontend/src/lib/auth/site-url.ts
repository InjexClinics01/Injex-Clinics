import "server-only";

import { headers } from "next/headers";

/**
 * Absolute base URL used in auth emails (password reset / invitations).
 * Prefer the configured NEXT_PUBLIC_SITE_URL so links cannot be influenced by
 * a spoofed Host header; fall back to the request host in development.
 */
export async function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
