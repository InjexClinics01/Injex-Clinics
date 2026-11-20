"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { adjustmentSchema, formatPoints, readAdjustment } from "@/lib/points/schemas";
import { createClient } from "@/lib/supabase/server";
import { rpcErrorMessage } from "@/lib/supabase/rpc-error";

/** Manual adjustment with a mandatory reason. The database posts it to the ledger and the audit log. */
export async function adjustPoints(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const raw = readAdjustment(formData);
  const parsed = adjustmentSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: raw };
  const { employee_id, amount, reason } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_points", { p_employee: employee_id, p_amount: amount, p_reason: reason });
  if (error) return { status: "error", message: rpcErrorMessage(error, "Could not adjust the points."), values: raw };

  revalidatePath("/", "layout");
  return { status: "success", message: `${formatPoints(amount, true)} points recorded.` };
}
