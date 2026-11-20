"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireEmployee } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/validation";
import { isIsoDate } from "@/lib/metrics/periods";
import { parseEntryValues } from "@/lib/metrics/values";
import { rpcErrorMessage } from "@/lib/supabase/rpc-error";
import { createClient } from "@/lib/supabase/server";
import { appToday, listMetrics } from "@/services/metrics";


/** Save a daily entry as a draft, or save and submit it for review. */
export async function saveEntry(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireEmployee();
  if (!profile.employee_category) {
    return { status: "error", message: "You have not been assigned a category yet. Please contact your administrator." };
  }

  const submitting = formData.get("intent") === "submit";
  const date = String(formData.get("entry_date") ?? "");
  if (!isIsoDate(date) || date > appToday()) {
    return { status: "error", message: "Choose a valid date (today or earlier)." };
  }

  const metrics = (await listMetrics(profile.employee_category)).filter((m) => m.is_active && m.kind === "input");
  const raw = Object.fromEntries(metrics.map((m) => [m.id, String(formData.get(m.id) ?? "")]));
  const { values, cleared, errors } = parseEntryValues(metrics, raw, { submitting });
  if (Object.keys(errors).length > 0) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: errors };
  }

  const supabase = await createClient();
  const entry = await findOrCreateEntry(profile.id, date);
  if ("error" in entry) return { status: "error", message: entry.error };
  if (entry.status === "rejected" && entry.final_rejection) {
    return { status: "error", message: "This entry was rejected and can no longer be edited. Contact your administrator." };
  }
  if (entry.status !== "draft" && entry.status !== "rejected") {
    return { status: "error", message: "This entry has already been submitted and can no longer be edited." };
  }

  const rows = Object.entries(values).map(([metric_id, value]) => ({ entry_id: entry.id, metric_id, value }));
  const [saved, removed] = await Promise.all([
    rows.length
      ? supabase.from("metric_entry_values").upsert(rows, { onConflict: "entry_id,metric_id" })
      : Promise.resolve({ error: null }),
    cleared.length
      ? supabase.from("metric_entry_values").delete().eq("entry_id", entry.id).in("metric_id", cleared)
      : Promise.resolve({ error: null }),
  ]);
  if (saved.error || removed.error) {
    return { status: "error", message: databaseMessage(saved.error ?? removed.error) };
  }

  if (submitting) {
    const { error } = await supabase.from("metric_entries").update({ status: "pending" }).eq("id", entry.id);
    if (error) return { status: "error", message: databaseMessage(error) };
  }

  revalidatePath("/employee", "layout");
  return { status: "success", message: submitting ? "Entry submitted for review." : "Draft saved." };
}

/** Move a pending entry back to draft so it can be edited again. */
export async function withdrawEntry(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireEmployee();
  const entryId = z.uuid().safeParse(formData.get("entry_id"));
  if (!entryId.success) return { status: "error", message: "Unknown entry." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("metric_entries")
    .update({ status: "draft" })
    .eq("id", entryId.data)
    .eq("employee_id", profile.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error || !data) return { status: "error", message: "This entry can no longer be withdrawn." };

  revalidatePath("/employee", "layout");
  return { status: "success", message: "Entry moved back to draft. You can edit it now." };
}

async function findOrCreateEntry(employeeId: string, date: string) {
  const supabase = await createClient();
  const find = () =>
    supabase
      .from("metric_entries")
      .select("id, status, final_rejection")
      .eq("employee_id", employeeId)
      .eq("entry_date", date)
      .maybeSingle();

  const existing = await find();
  if (existing.data) return existing.data;

  const created = await supabase
    .from("metric_entries")
    .insert({ employee_id: employeeId, entry_date: date })
    .select("id, status, final_rejection")
    .single();
  if (created.data) return created.data;

  // Saved at the same moment from another tab: use the entry that won.
  if (created.error?.code === "23505") {
    const again = await find();
    if (again.data) return again.data;
  }
  return { error: databaseMessage(created.error) };
}

function databaseMessage(error: { code?: string; message?: string } | null): string {
  return rpcErrorMessage(error, "Could not save your entry. Please try again.");
}
