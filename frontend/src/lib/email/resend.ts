import { Resend } from "resend";

let cachedResend: Resend | null = null;

/**
 * Checks whether Resend has an API key configured.
 */
export function isResendConfigured(): boolean {
  const key = process.env.RESEND_API_KEY?.trim();
  return Boolean(key && key.startsWith("re_") && key !== "re_your_api_key_here");
}

/**
 * Returns a configured Resend instance, or null if the API key is missing.
 */
export function getResendClient(): Resend | null {
  if (!isResendConfigured()) {
    return null;
  }
  if (!cachedResend) {
    cachedResend = new Resend(process.env.RESEND_API_KEY!.trim());
  }
  return cachedResend;
}

/**
 * Returns the default "From" address for outbound emails.
 */
export function getDefaultFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Injex Clinics <onboarding@resend.dev>";
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Dispatches an email via the Resend API.
 * Never throws — returns a structured result so callers can gracefully fall back or log.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const resend = getResendClient();
  if (!resend) {
    return {
      success: false,
      error: "Resend is not configured (missing or invalid RESEND_API_KEY).",
    };
  }

  const from = options.from || getDefaultFromEmail();

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    });

    if (error) {
      console.error("[Email / Resend] Failed to send email:", error);
      return {
        success: false,
        error: error.message || "Failed to send email via Resend.",
      };
    }

    return {
      success: true,
      id: data?.id,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Email / Resend] Unexpected error while sending email:", message);
    return {
      success: false,
      error: message,
    };
  }
}
