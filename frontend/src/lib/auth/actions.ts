"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { AdminClientNotConfiguredError, createAdminClient } from "@/lib/supabase/admin";
import { REMEMBER_COOKIE, REMEMBER_MAX_AGE_SECONDS } from "@/lib/supabase/session-cookies";
import { isResendConfigured, sendEmail } from "@/lib/email/resend";
import { generatePasswordResetEmail } from "@/lib/email/templates/password-reset";
import { authErrorMessage, URL_ERROR_MESSAGES } from "./errors";
import { homeForRole, safeRedirectPath, canAccessPath } from "./routes";
import { getSiteUrl } from "./site-url";
import { getCurrentProfile } from "./session";
import { readSignup, signupSchema } from "./signup-schema";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  newPasswordSchema,
  readChangePassword,
  readForgotPassword,
  readLogin,
  readNewPassword,
  toFieldErrors,
  type FormState,
} from "./validation";

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = readLogin(formData);
  const parsed = loginSchema.safeParse(raw);
  const values = { email: raw.email };
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };
  }
  if (!isSupabaseConfigured()) return { status: "error", message: URL_ERROR_MESSAGES.not_configured, values };
  const { email, password, remember, next } = parsed.data;

  const cookieStore = await cookies();
  cookieStore.set(REMEMBER_COOKIE, remember ? "1" : "0", {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    ...(remember ? { maxAge: REMEMBER_MAX_AGE_SECONDS } : {}),
  });

  const supabase = await createClient({ persistSession: remember });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { status: "error", message: authErrorMessage(error), values };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut({ scope: "local" });
    const isPending =
      data.user.app_metadata?.signup_status === "pending" ||
      data.user.user_metadata?.signup_status === "pending";

    if (isPending) {
      return {
        status: "error",
        message: "Your registration is awaiting administrator approval. You will be able to sign in once approved.",
        values,
      };
    }

    return {
      status: "error",
      message: profile
        ? "This account has been deactivated. Please contact your administrator."
        : "Your account has not been set up yet. Please contact your administrator.",
      values,
    };
  }

  const home = homeForRole(profile.role);
  const target = safeRedirectPath(next, home);
  redirect(canAccessPath(profile.role, target) && target !== "/" ? target : home);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?signed_out=1");
}
/**
 * Always reports success so the form cannot be used to discover which email
 * addresses have accounts.
 */
export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = readForgotPassword(formData);
  const parsed = forgotPasswordSchema.safeParse(raw);
  const values = { email: raw.email };
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };
  }

  if (!isSupabaseConfigured()) return { status: "error", message: URL_ERROR_MESSAGES.not_configured, values };
  const siteUrl = await getSiteUrl();

  // Primary: Dispatch via Resend if API key is configured
  if (isResendConfigured()) {
    try {
      const adminClient = createAdminClient();
      const { data, error } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: parsed.data.email,
        options: {
          redirectTo: `${siteUrl}/auth/confirm?next=/reset-password`,
        },
      });

      if (!error && data?.properties) {
        // Construct the reset URL (prefer token_hash to route directly through our /auth/confirm)
        const resetUrl = data.properties.hashed_token
          ? `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery&next=/reset-password`
          : data.properties.action_link;

        const { data: profile } = await adminClient
          .from("profiles")
          .select("full_name")
          .eq("email", parsed.data.email.toLowerCase())
          .maybeSingle();

        const emailContent = generatePasswordResetEmail({
          recipientName: profile?.full_name || undefined,
          resetUrl,
        });

        await sendEmail({
          to: parsed.data.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });
      }
    } catch (err) {
      console.error("[Auth / Reset Password] Error sending via Resend:", err);
    }

    return {
      status: "success",
      message: "If an account exists for that email, a password reset link is on its way. Check your inbox (and spam folder).",
    };
  }

  // Fallback: Default Supabase email delivery if Resend is not yet configured
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl}/auth/confirm?next=/reset-password`,
  });

  if (error && (error.status === 429 || error.status === undefined || error.status >= 500)) {
    return { status: "error", message: authErrorMessage(error), values };
  }
  return {
    status: "success",
    message: "If an account exists for that email, a password reset link is on its way. Check your inbox (and spam folder).",
  };
}

/** How long after opening a reset/invite link the user may set a password. */
const RECOVERY_WINDOW_SECONDS = 60 * 60;

/**
 * /reset-password only. Allowed ONLY for a session that was started from an
 * emailed link (recovery / invite) within the last hour. A normal password
 * session must use changePassword(), which asks for the current password, so a
 * hijacked or unattended session cannot silently take over the account.
 */
export async function resetPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse(readNewPassword(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) {
    return { status: "error", message: "Your reset link has expired. Please request a new one." };
  }

  const now = Math.floor(Date.now() / 1000);
  const fromEmailLink = (claims.amr ?? []).some(
    (entry) =>
      typeof entry === "object" &&
      entry.method !== "password" &&
      typeof entry.timestamp === "number" &&
      now - entry.timestamp <= RECOVERY_WINDOW_SECONDS,
  );
  if (!fromEmailLink) {
    return {
      status: "error",
      message: "This reset session has expired. Request a new link, or change your password from My profile.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { status: "error", message: authErrorMessage(error) };
  redirect("/dashboard");
}

/** Profile page: change password, re-verifying the CURRENT password first. */
export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await getCurrentProfile();
  if (!profile?.is_active) redirect("/login");

  const parsed = changePasswordSchema.safeParse(readChangePassword(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: parsed.data.currentPassword,
  });
  if (verifyError) {
    return verifyError.code === "invalid_credentials" || /invalid login credentials/i.test(verifyError.message)
      ? { status: "error", fieldErrors: { currentPassword: "Your current password is incorrect." } }
      : { status: "error", message: authErrorMessage(verifyError) };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { status: "error", message: authErrorMessage(error) };
  return { status: "success", message: "Your password has been changed." };
}

/**
 * Self-registration for nurses and beauty therapists.
 * Creates an inactive user and places an entry in the pending registration queue
 * for administrator review.
 */
export async function registerEmployee(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = readSignup(formData);
  const parsed = signupSchema.safeParse(raw);
  const values = {
    full_name: typeof raw.full_name === "string" ? raw.full_name : "",
    email: typeof raw.email === "string" ? raw.email : "",
    employee_category: typeof raw.employee_category === "string" ? raw.employee_category : "",
  };

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };
  }

  if (!isSupabaseConfigured()) {
    return { status: "error", message: URL_ERROR_MESSAGES.not_configured, values };
  }

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    if (e instanceof AdminClientNotConfiguredError) {
      return {
        status: "error",
        message: "Registration is temporarily unavailable. Please contact your clinic administrator.",
        values,
      };
    }
    throw e;
  }

  const { email, password, full_name, employee_category } = parsed.data;

  // 1. Check if an active account already exists for this email
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id, is_active")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile) {
    if (existingProfile.is_active) {
      return {
        status: "error",
        message: "An account with this email already exists. Please sign in instead.",
        values,
      };
    }
    return {
      status: "error",
      message: "A registration request for this email is already awaiting administrator approval.",
      values,
    };
  }

  // 2. Check if a pending registration request already exists in the queue
  const { data: existingRequest } = await adminClient
    .from("employee_registration_requests")
    .select("id")
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  if (existingRequest) {
    return {
      status: "error",
      message: "A registration request for this email is already awaiting administrator approval.",
      values,
    };
  }

  // 3. Create auth user with unapproved status
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, signup_status: "pending" },
    app_metadata: { role: "employee", employee_category, signup_status: "pending" },
  });

  if (authError || !authData.user) {
    const msg = authError?.message?.toLowerCase() ?? "";
    if (msg.includes("already registered") || msg.includes("already exists")) {
      return {
        status: "error",
        message: "An account with this email already exists. Please sign in instead.",
        values,
      };
    }
    return {
      status: "error",
      message: authError ? authErrorMessage(authError) : "Could not submit registration. Please try again.",
      values,
    };
  }

  const userId = authData.user.id;

  // 4. Ensure profile is explicitly inactive until admin approval
  await adminClient
    .from("profiles")
    .update({
      full_name,
      role: "employee",
      employee_category,
      is_active: false,
    })
    .eq("id", userId);

  // 5. Insert into the registration requests queue
  await adminClient
    .from("employee_registration_requests")
    .insert({
      full_name,
      email,
      employee_category,
      status: "pending",
      auth_user_id: userId,
    });

  // 6. Record audit log entry
  await adminClient.from("audit_logs").insert({
    user_id: null,
    action: "registration.submitted",
    entity_type: "registration_request",
    entity_id: userId,
    details: { email, employee_category, full_name },
  });

  return {
    status: "success",
    message: "Your registration request has been submitted! An administrator must approve your account before you can sign in.",
  };
}
