import { z } from "zod";

import { emailSchema, fullNameSchema, passwordSchema } from "@/lib/auth/validation";

/**
 * Validation schema for employee self-registration.
 * Shared between the /signup form in the browser and the server action.
 */
export const signupSchema = z.object({
  full_name: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
  confirm_password: z.string().min(1, "Confirm your password."),
  employee_category: z.enum(["nurse", "beauty_therapist"], {
    error: "Select your role category (Nurse or Beauty Therapist).",
  }),
}).refine((data) => data.password === data.confirm_password, {
  path: ["confirm_password"],
  message: "Passwords do not match.",
});

export type SignupInput = z.infer<typeof signupSchema>;

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export const readSignup = (fd: FormData): Record<string, unknown> => ({
  full_name: str(fd, "full_name"),
  email: str(fd, "email"),
  password: str(fd, "password"),
  confirm_password: str(fd, "confirm_password"),
  employee_category: str(fd, "employee_category"),
});

export const decideRegistrationSchema = z.object({
  requestId: z.string().uuid("Invalid request ID."),
  decision: z.enum(["approve", "reject"]),
  rejectionReason: z.string().max(500, "Reason is too long.").optional(),
});
