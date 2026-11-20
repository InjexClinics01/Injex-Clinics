import { z } from "zod";

import { emailSchema, fullNameSchema, passwordSchema } from "@/lib/auth/validation";

/** Shared by the employee dialog (instant feedback) and the server actions. */

const role = z.enum(["admin", "employee"], { error: "Choose a role." });

const category = z
  .string()
  .trim()
  .max(50, "Unknown category.")
  .regex(/^([a-z][a-z0-9_]{1,49})?$/, "Unknown category.")
  .transform((v) => (v === "" ? null : v));

function requireCategoryForEmployees(v: { role: string; employee_category: string | null }) {
  return v.role !== "employee" || Boolean(v.employee_category);
}
const categoryIssue = { path: ["employee_category"], message: "Employees must be assigned a category." };

// =============================================================================
// Note: createEmployeeSchema and readCreateEmployee are disabled/deprecated because
// manual employee creation by admin has been replaced with employee self-signup
// (/signup) followed by admin approval in the "Pending Requests" tab.
// See @/lib/auth/signup-schema.ts for the active self-signup schema.
// =============================================================================
export const createEmployeeSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("invite"), full_name: fullNameSchema, email: emailSchema, role, employee_category: category }),
    z.object({
      mode: z.literal("password"),
      full_name: fullNameSchema,
      email: emailSchema,
      role,
      employee_category: category,
      password: passwordSchema,
    }),
  ])
  .refine(requireCategoryForEmployees, categoryIssue);

export const updateEmployeeSchema = z
  .object({
    id: z.uuid({ error: "Invalid employee." }),
    full_name: fullNameSchema,
    role,
    employee_category: category,
    is_active: z.boolean(),
  })
  .refine(requireCategoryForEmployees, categoryIssue);

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export const readCreateEmployee = (fd: FormData) => ({
  mode: fd.get("mode") === "password" ? ("password" as const) : ("invite" as const),
  full_name: str(fd, "full_name"),
  email: str(fd, "email"),
  role: str(fd, "role"),
  employee_category: str(fd, "employee_category"),
  password: str(fd, "password"),
});

export const readUpdateEmployee = (fd: FormData) => ({
  id: str(fd, "id"),
  full_name: str(fd, "full_name"),
  role: str(fd, "role"),
  employee_category: str(fd, "employee_category"),
  is_active: fd.get("is_active") === "on",
});
