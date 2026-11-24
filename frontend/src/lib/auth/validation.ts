import { z } from "zod";

/**
 * Shared validation rules. Imported by BOTH the browser (instant feedback) and
 * the server actions (authoritative), so the rules can never drift apart.
 */

export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
/** Supabase Auth (bcrypt) only uses the first 72 BYTES of a password. */
const PASSWORD_MAX_BYTES = 72;
export const NAME_MAX_LENGTH = 120;

const byteLength = (v: string) => new TextEncoder().encode(v).length;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export const emailSchema = z
  .string({ error: "Email is required." })
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .max(EMAIL_MAX_LENGTH, "Email is too long.")
  .pipe(z.email({ error: "Enter a valid email address." }));

/** Rules for choosing a NEW password. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .refine((v) => byteLength(v) <= PASSWORD_MAX_BYTES, "Password is too long (maximum 72 characters).")
  .refine((v) => !CONTROL_CHARS.test(v), "Password contains invalid characters.")
  .refine((v) => v.trim() === v, "Password cannot start or end with a space.")
  .refine((v) => /\p{Lu}/u.test(v), "Password must contain at least one uppercase letter.")
  .refine((v) => /\p{Ll}/u.test(v), "Password must contain at least one lowercase letter.")
  .refine((v) => /\p{N}/u.test(v), "Password must contain a number.");

/** Rules for an EXISTING password (login / current password): presence + sane size only. */
const existingPasswordSchema = z
  .string()
  .min(1, "Password is required.")
  .refine((v) => byteLength(v) <= PASSWORD_MAX_BYTES, "Password is too long.");

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Enter a full name (at least 2 characters).")
  .max(NAME_MAX_LENGTH, `Name must be ${NAME_MAX_LENGTH} characters or fewer.`)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}' .\-]*$/u, "Names can contain letters, spaces, apostrophes, hyphens and full stops.")
  .transform((v) => v.replace(/\s+/g, " "));

export const loginSchema = z.object({
  email: emailSchema,
  password: existingPasswordSchema,
  remember: z.boolean(),
  next: z.string().max(2048).optional(),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string().min(1, "Confirm your new password.") })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export const changePasswordSchema = z
  .object({
    currentPassword: existingPasswordSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." })
  .refine((v) => v.password !== v.currentPassword, {
    path: ["password"],
    message: "Your new password must be different from your current password.",
  });

export const profileSchema = z.object({ full_name: fullNameSchema });

// -----------------------------------------------------------------------------
// FormData readers (same shape on client and server)
// -----------------------------------------------------------------------------
const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export const readLogin = (fd: FormData) => ({
  email: str(fd, "email"),
  password: str(fd, "password"),
  remember: fd.get("remember") === "on",
  next: str(fd, "next") || undefined,
});
export const readForgotPassword = (fd: FormData) => ({ email: str(fd, "email") });
export const readNewPassword = (fd: FormData) => ({
  password: str(fd, "password"),
  confirmPassword: str(fd, "confirmPassword"),
});
export const readChangePassword = (fd: FormData) => ({ ...readNewPassword(fd), currentPassword: str(fd, "currentPassword") });
export const readProfile = (fd: FormData) => ({ full_name: str(fd, "full_name") });

// -----------------------------------------------------------------------------
// Form state
// -----------------------------------------------------------------------------

/** Field-level errors for forms: { email: "…", password: "…" } */
export type FieldErrors = Partial<Record<string, string>>;

export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/** Build a client-side validator from a schema + FormData reader. */
export function validator<T>(schema: z.ZodType<T>, read: (fd: FormData) => unknown) {
  return (fd: FormData): FieldErrors | null => {
    const result = schema.safeParse(read(fd));
    return result.success ? null : toFieldErrors(result.error);
  };
}

export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: FieldErrors;
  /** Echoed non-secret values so inputs keep their content after a failed submit. */
  values?: Record<string, string>;
};

export const initialFormState: FormState = { status: "idle" };
