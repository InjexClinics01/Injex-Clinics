"use server";

import { revalidatePath } from "next/cache";

import {
  /* Commented out: Manual employee creation disabled in favor of self-signup with admin approval
  createEmployeeSchema,
  readCreateEmployee,
  */
  readUpdateEmployee,
  updateEmployeeSchema,
} from "@/lib/admin/employee-schema";
import { requireAdmin } from "@/lib/auth/session";
import { getSiteUrl } from "@/lib/auth/site-url";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { sendEmail } from "@/lib/email/resend";
import {
  generateRegistrationApprovedEmail,
  generateRegistrationRejectedEmail,
} from "@/lib/email/templates/registration-decision";
import { AdminClientNotConfiguredError, createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Effectively permanent ban used for deactivated accounts (~100 years). */
const DEACTIVATED_BAN = "876000h";

function revalidate() {
  revalidatePath("/admin", "layout");
}

async function categoryExists(slug: string | null) {
  if (!slug) return true;
  const supabase = await createClient();
  const { data } = await supabase.from("employee_categories").select("slug").eq("slug", slug).maybeSingle();
  return Boolean(data);
}

/**
 * Create an employee account. Public sign-up is disabled, so this is the only
 * way accounts are created. Requires SUPABASE_SECRET_KEY on the server.
 */
// =============================================================================
// Commented out: Manual employee creation by admin is disabled in favor of
// employee self-signup with administrator approval.
// Prospective employees now self-register on /signup, and administrators approve
// or reject them from the "Pending Requests" tab in /admin/employees.
// =============================================================================
/*
export async function createEmployee(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();

  const raw = readCreateEmployee(formData);
  // Never echo the password back to the browser.
  const values = { full_name: raw.full_name, email: raw.email, role: raw.role, employee_category: raw.employee_category };

  const parsed = createEmployeeSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };
  const input = parsed.data;

  if (!(await categoryExists(input.employee_category))) {
    return { status: "error", fieldErrors: { employee_category: "Unknown category." }, values };
  }

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    if (e instanceof AdminClientNotConfiguredError) {
      return {
        status: "error",
        message: "Account creation is not configured: set SUPABASE_SECRET_KEY on the server (see README).",
        values,
      };
    }
    throw e;
  }

  const appMetadata = { role: input.role, employee_category: input.employee_category, created_by: admin.id };

  let userId: string;
  if (input.mode === "password") {
    const { data, error } = await adminClient.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
      app_metadata: appMetadata,
    });
    if (error || !data.user) return { status: "error", message: adminAuthError(error), values };
    userId = data.user.id;
  } else {
    const siteUrl = await getSiteUrl();
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(input.email, {
      data: { full_name: input.full_name },
      redirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent("/reset-password?welcome=1")}`,
    });
    if (error || !data.user) return { status: "error", message: adminAuthError(error), values };
    userId = data.user.id;
  }

  // Apply role/category to the profile EXPLICITLY for both modes: Supabase Auth
  // inserts the user before it saves app_metadata (and invitations cannot carry
  // app_metadata at all), so the profile trigger only ever sees the defaults.
  const [{ error: metaError }, { data: saved, error: profileError }] = await Promise.all([
    input.mode === "invite"
      ? adminClient.auth.admin.updateUserById(userId, { app_metadata: appMetadata })
      : Promise.resolve({ error: null }),
    adminClient
      .from("profiles")
      .update({ role: input.role, employee_category: input.employee_category })
      .eq("id", userId)
      .select("id")
      .maybeSingle(),
  ]);
  await adminClient.from("audit_logs").insert({
    user_id: admin.id,
    action: input.mode === "invite" ? "profile.invited" : "profile.created_by_admin",
    entity_type: "profile",
    entity_id: userId,
    details: { email: input.email, role: input.role, employee_category: input.employee_category },
  });
  if (metaError || profileError || !saved) {
    revalidate();
    return {
      status: "error",
      message: `${input.mode === "invite" ? "Invitation sent" : "Account created"}, but the role/category could not be saved. Please edit the employee to set them.`,
    };
  }

  revalidate();
  return {
    status: "success",
    message:
      input.mode === "invite"
        ? `Invitation sent to ${input.email}.`
        : `Account created for ${input.email}. Share the temporary password securely.`,
  };
}
*/

/**
 * Update name / role / category / status. Runs with the ADMIN'S OWN session,
 * so RLS and the database guards (no self-demotion, last-admin protection)
 * apply in addition to the checks here.
 */
export async function updateEmployee(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();

  const raw = readUpdateEmployee(formData);
  const values = {
    full_name: raw.full_name,
    role: raw.role,
    employee_category: raw.employee_category,
    is_active: raw.is_active ? "on" : "",
  };
  const parsed = updateEmployeeSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };
  const input = parsed.data;

  if (!(await categoryExists(input.employee_category))) {
    return { status: "error", fieldErrors: { employee_category: "Unknown category." }, values };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase.from("profiles").select("id, is_active").eq("id", input.id).maybeSingle();
  if (!existing) return { status: "error", message: "Employee not found.", values };

  const isSelf = input.id === admin.id;
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: input.full_name,
      employee_category: input.employee_category,
      ...(isSelf ? {} : { role: input.role, is_active: input.is_active }),
    })
    .eq("id", input.id);

  if (error) {
    if (error.code === "42501") return { status: "error", message: "You can't change your own role or active status.", values };
    if (error.code === "P0001") return { status: "error", message: "At least one active administrator is required.", values };
    if (error.code === "23514") return { status: "error", message: "Some details are invalid. Please check and try again.", values };
    return { status: "error", message: "Could not save changes. Please try again.", values };
  }

  let warning: string | undefined;
  const deactivated = !isSelf && existing.is_active && !input.is_active;
  const rejected = deactivated ? await rejectPendingRedemptions(input.id) : { count: 0, failed: false };
  if (!isSelf && existing.is_active !== input.is_active) {
    // Also block/unblock sign-in at the Auth level. Access is already removed by
    // RLS + the proxy; this stops session refresh and new logins.
    try {
      const { error: banError } = await createAdminClient().auth.admin.updateUserById(input.id, {
        ban_duration: input.is_active ? "none" : DEACTIVATED_BAN,
      });
      if (banError) warning = "Status saved, but the sign-in block could not be updated.";
    } catch (e) {
      if (!(e instanceof AdminClientNotConfiguredError)) throw e;
      warning = "Status saved. Configure SUPABASE_SECRET_KEY to also block sign-in at the Auth level.";
    }
  }

  revalidate();
  if (rejected.failed) warning = "Saved, but their pending reward requests could not all be rejected. Check the Rewards page.";
  const released = rejected.count > 0 ? ` ${rejected.count} pending reward request${rejected.count === 1 ? " was" : "s were"} rejected.` : "";
  return { status: "success", message: warning ?? `Changes saved.${released}` };
}

/** A deactivated employee can't collect a reward, so their open requests are closed and the points released. */
async function rejectPendingRedemptions(employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("reward_redemptions").select("id").eq("employee_id", employeeId).eq("status", "pending");
  if (error) return { count: 0, failed: true };
  const results = await Promise.all(
    data.map((r) => supabase.rpc("decide_redemption", { p_redemption: r.id, p_decision: "reject", p_note: "Account deactivated" })),
  );
  return { count: data.length, failed: results.some((r) => r.error) };
}

// Commented out: adminAuthError was only used by manual createEmployee
/*
function adminAuthError(error: { code?: string; message?: string; status?: number } | null): string {
  if (!error) return "Could not create the account. Please try again.";
  if (error.code === "email_exists" || error.code === "user_already_exists" || /already (been )?registered/i.test(error.message ?? "")) {
    return "An account with this email already exists.";
  }
  if (error.code === "weak_password") return "That password is too weak.";
  if (error.code === "over_email_send_rate_limit" || error.status === 429) {
    return "Email rate limit reached. Configure custom SMTP in Supabase or use a temporary password instead.";
  }
  return "Could not create the account. Please try again.";
}
*/

/**
 * Administrator action to approve a pending registration request.
 * Activates the employee profile so they can sign in immediately.
 */
export async function approveRegistrationRequest(requestId: string): Promise<FormState> {
  const admin = await requireAdmin();

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    if (e instanceof AdminClientNotConfiguredError) {
      return { status: "error", message: "Admin client not configured." };
    }
    throw e;
  }

  const { data: request, error: fetchError } = await adminClient
    .from("employee_registration_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (fetchError || !request) {
    return { status: "error", message: "Registration request not found." };
  }

  if (request.status !== "pending") {
    return { status: "error", message: `This request has already been ${request.status}.` };
  }

  // 1. Activate profile
  if (request.auth_user_id) {
    await adminClient
      .from("profiles")
      .update({
        is_active: true,
        role: "employee",
        employee_category: request.employee_category,
      })
      .eq("id", request.auth_user_id);

    // Update app_metadata on the auth user
    await adminClient.auth.admin.updateUserById(request.auth_user_id, {
      app_metadata: {
        role: "employee",
        employee_category: request.employee_category,
        signup_status: "approved",
      },
    });
  }

  // 2. Mark request as approved
  await adminClient
    .from("employee_registration_requests")
    .update({
      status: "approved",
      decided_by: admin.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  // 3. Log audit event
  await adminClient.from("audit_logs").insert({
    user_id: admin.id,
    action: "registration.approved",
    entity_type: "registration_request",
    entity_id: requestId,
    details: {
      email: request.email,
      employee_category: request.employee_category,
      auth_user_id: request.auth_user_id,
    },
  });

  // 4. Send approval notification email
  const siteUrl = await getSiteUrl();
  const { subject, html, text } = generateRegistrationApprovedEmail({
    recipientName: request.full_name,
    category: request.employee_category,
    loginUrl: `${siteUrl}/login`,
  });
  await sendEmail({
    to: request.email,
    subject,
    html,
    text,
  });

  revalidate();
  return {
    status: "success",
    message: `${request.full_name} (${request.email}) has been approved and activated.`,
  };
}

/**
 * Administrator action to reject a pending registration request.
 * Removes the unapproved auth user so the email can be re-used, and marks the request rejected.
 */
export async function rejectRegistrationRequest(requestId: string, reason?: string): Promise<FormState> {
  const admin = await requireAdmin();

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    if (e instanceof AdminClientNotConfiguredError) {
      return { status: "error", message: "Admin client not configured." };
    }
    throw e;
  }

  const { data: request, error: fetchError } = await adminClient
    .from("employee_registration_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (fetchError || !request) {
    return { status: "error", message: "Registration request not found." };
  }

  if (request.status !== "pending") {
    return { status: "error", message: `This request has already been ${request.status}.` };
  }

  // 1. Delete unapproved auth user so they cannot sign in and email is freed
  if (request.auth_user_id) {
    await adminClient.auth.admin.deleteUser(request.auth_user_id);
  }

  // 2. Mark request rejected for audit history
  await adminClient
    .from("employee_registration_requests")
    .update({
      status: "rejected",
      rejection_reason: reason || null,
      decided_by: admin.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  // 3. Log audit event
  await adminClient.from("audit_logs").insert({
    user_id: admin.id,
    action: "registration.rejected",
    entity_type: "registration_request",
    entity_id: requestId,
    details: {
      email: request.email,
      employee_category: request.employee_category,
      reason: reason || null,
    },
  });

  // 4. Send rejection notification email
  const { subject, html, text } = generateRegistrationRejectedEmail({
    recipientName: request.full_name,
    reason,
  });
  await sendEmail({
    to: request.email,
    subject,
    html,
    text,
  });

  revalidate();
  return {
    status: "success",
    message: `Registration request for ${request.full_name} has been rejected.`,
  };
}
