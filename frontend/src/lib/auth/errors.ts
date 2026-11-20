import type { AuthError } from "@supabase/supabase-js";

/** Translate Supabase Auth errors into messages suitable for staff. */
export function authErrorMessage(error: AuthError | null | undefined): string {
  if (!error) return "Something went wrong. Please try again.";
  const code = error.code ?? "";
  const status = error.status ?? 0;

  if (code === "invalid_credentials" || /invalid login credentials/i.test(error.message)) {
    return "Incorrect email or password.";
  }
  if (code === "user_banned") return "This account has been deactivated. Please contact your administrator.";
  if (code === "email_not_confirmed") return "Your email address has not been confirmed yet. Please check your inbox.";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || status === 429) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (code === "same_password") return "Your new password must be different from your current password.";
  if (code === "weak_password") return "That password is too weak. Please choose a stronger one.";
  if (code === "reauthentication_needed") return "For security, please sign in again before changing your password.";
  if (code === "session_not_found" || code === "session_expired") return "Your session has expired. Please sign in again.";
  if (status >= 500 || error.name === "AuthRetryableFetchError") {
    return "The authentication service is unavailable. Please try again shortly.";
  }
  return "Something went wrong. Please try again.";
}

/** Messages for ?error=… codes the app puts in URLs. */
export const URL_ERROR_MESSAGES: Record<string, string> = {
  registration_pending: "Your registration is awaiting administrator approval. You will be able to sign in once approved.",
  account_inactive: "Your account is inactive. Please contact your administrator.",
  link_invalid: "That link is invalid or has expired. Please request a new one.",
  not_configured: "The application is not connected to Supabase yet. See the setup guide in README.md.",
  forbidden: "You don't have permission to view that page.",
  session_expired: "Your session has expired. Please sign in again.",
};
