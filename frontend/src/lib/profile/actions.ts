"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { profileSchema, readProfile, toFieldErrors, type FormState } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

/** Users may change only their own display name (enforced by RLS + DB guard). */
export async function updateOwnProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireUser();
  const raw = readProfile(formData);
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: raw };

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ full_name: parsed.data.full_name }).eq("id", profile.id);
  if (error) return { status: "error", message: "Could not save your profile. Please try again.", values: raw };

  revalidatePath("/", "layout");
  return { status: "success", message: "Profile updated.", values: { full_name: parsed.data.full_name } };
}
