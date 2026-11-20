import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeRedirectPath } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES: EmailOtpType[] = ["recovery", "invite", "email", "signup", "magiclink", "email_change"];

/**
 * Landing point for links in Supabase auth emails (password reset, invites).
 * Supports both the recommended token-hash links and PKCE `code` links.
 * See README → "Email templates".
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  // Invited users must choose a password before using the app.
  const defaultNext = type === "invite" ? "/reset-password?welcome=1" : "/dashboard";
  const next = safeRedirectPath(searchParams.get("next"), defaultNext);

  const supabase = await createClient();
  let ok = false;

  if (tokenHash && type && EMAIL_OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const destination = ok ? next : "/login?error=link_invalid";

  return NextResponse.redirect(new URL(destination, request.nextUrl.origin));
} 