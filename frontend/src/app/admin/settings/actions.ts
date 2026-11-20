"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { pointsSettingsSchema, readPointsSettings } from "@/lib/points/schemas";
import { createClient } from "@/lib/supabase/server";

export async function saveLeaderboardSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const enabled = formData.get("overall_leaderboard_enabled") === "on";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .update({ overall_leaderboard_enabled: enabled })
    .eq("singleton", true)
    .select("id")
    .maybeSingle();
  if (error || !data) return { status: "error", message: "Could not save the setting. Please try again." };

  revalidatePath("/", "layout");
  return {
    status: "success",
    message: enabled ? "Employees can now see the overall leaderboard." : "The overall leaderboard is now visible to admins only.",
  };
}

/** Points start date and the optional consistency streak (changes are audited by the database). */
export async function savePointsSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const raw = readPointsSettings(formData);
  const values = { ...raw, streak_enabled: raw.streak_enabled ? "on" : "" };
  const parsed = pointsSettingsSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase.from("app_settings").update(parsed.data).eq("singleton", true).select("id").maybeSingle();
  if (error || !data) return { status: "error", message: "Could not save the points settings. Please try again.", values };

  revalidatePath("/", "layout");
  return { status: "success", message: "Points settings saved. They apply to periods credited from now on." };
}
