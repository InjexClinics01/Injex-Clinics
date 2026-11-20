"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { readRedemptionDecision, readReward, redemptionDecisionSchema, rewardSchema } from "@/lib/points/schemas";
import { createClient } from "@/lib/supabase/server";
import { rpcErrorMessage } from "@/lib/supabase/rpc-error";

/** Add or edit a catalogue reward (changes are audited by the database). */
export async function saveReward(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const raw = readReward(formData);
  const values = { ...raw, is_active: raw.is_active ? "on" : "" };
  const parsed = rewardSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };
  const { id, name, description, points_cost, stock, is_active } = parsed.data;
  const fields = { name, description: description || null, points_cost, stock, is_active };

  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("rewards").update(fields).eq("id", id).select("id").maybeSingle()
    : await supabase.from("rewards").insert(fields).select("id").single();
  if (error) {
    const message = error.code === "23505" ? "A reward with this name already exists." : "Could not save the reward. Please check the values.";
    return { status: "error", message, values };
  }
  if (!data) return { status: "error", message: "This reward no longer exists. Refresh the page.", values };

  revalidatePath("/", "layout");
  return { status: "success", message: id ? "Reward updated." : "Reward added." };
}

const DONE: Record<string, string> = {
  approve: "Approved. The points have been deducted.",
  reject: "Request rejected. The reserved points were released.",
  fulfil: "Marked as handed over.",
  refund: "Refunded. The points were returned to the employee.",
};

/** Approve, reject, mark as fulfilled or refund a redemption request. */
export async function decideRedemption(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const raw = readRedemptionDecision(formData);
  const parsed = redemptionDecisionSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { note: raw.note } };
  const { redemption_id, decision, note } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_redemption", { p_redemption: redemption_id, p_decision: decision, p_note: note });
  if (error) return { status: "error", message: rpcErrorMessage(error, "Could not update the request."), values: { note: raw.note } };

  revalidatePath("/", "layout");
  return { status: "success", message: DONE[decision] };
}
