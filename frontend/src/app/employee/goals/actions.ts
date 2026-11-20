"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireEmployee } from "@/lib/auth/session";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { nextPeriodStart, periodStart } from "@/lib/metrics/periods";
import { goalSchema, readGoal } from "@/lib/metrics/schemas";
import { rpcErrorMessage } from "@/lib/supabase/rpc-error";
import { createClient } from "@/lib/supabase/server";
import { appToday } from "@/services/metrics";

export async function createGoal(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireEmployee();
  const raw = readGoal(formData);
  const parsed = goalSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: raw };
  const { metric_id, period, when, target_value } = parsed.data;

  const today = appToday();
  const supabase = await createClient();
  // The database re-checks eligibility, category, period and duplicates.
  const { error } = await supabase.from("goals").insert({
    employee_id: profile.id,
    metric_id,
    period,
    period_start: when === "next" ? nextPeriodStart(period, today) : periodStart(period, today),
    target_value,
  });

  if (error) {
    const message =
      error.code === "23505"
        ? "You already have an active goal for this metric and period."
        : rpcErrorMessage(error, "Could not create the goal. Please try again.");
    return { status: "error", message, values: raw };
  }

  revalidatePath("/employee", "layout");
  return { status: "success", message: "Goal created." };
}

export async function cancelGoal(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireEmployee();
  const goalId = z.uuid().safeParse(formData.get("goal_id"));
  if (!goalId.success) return { status: "error", message: "Unknown goal." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("goals")
    .update({ status: "cancelled" })
    .eq("id", goalId.data)
    .eq("employee_id", profile.id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (error || !data) return { status: "error", message: "This goal could not be cancelled." };

  revalidatePath("/employee", "layout");
  return { status: "success", message: "Goal cancelled." };
}
