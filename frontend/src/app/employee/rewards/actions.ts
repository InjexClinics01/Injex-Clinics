"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireEmployee } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";
import { rpcErrorMessage } from "@/lib/supabase/rpc-error";

/** Ask for a reward. The database checks stock and available points, and reserves the points. */
export async function requestRedemption(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireEmployee();
  const rewardId = z.uuid().safeParse(formData.get("reward_id"));
  if (!rewardId.success) return { status: "error", message: "Unknown reward." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_redemption", { p_reward: rewardId.data });
  if (error) return { status: "error", message: rpcErrorMessage(error, "Could not send the request. Please try again.") };

  revalidatePath("/employee", "layout");
  return { status: "success", message: "Request sent. Your points are reserved until an administrator approves it." };
}

export async function cancelRedemption(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireEmployee();
  const id = z.uuid().safeParse(formData.get("redemption_id"));
  if (!id.success) return { status: "error", message: "Unknown request." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_redemption", { p_redemption: id.data });
  if (error) return { status: "error", message: rpcErrorMessage(error, "Could not cancel the request.") };

  revalidatePath("/employee", "layout");
  return { status: "success", message: "Request cancelled and points released." };
}
