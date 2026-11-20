"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/session";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { entryValuesVersion, parseEntryValues } from "@/lib/metrics/values";
import { readReview, reviewSchema, type ReviewDecision } from "@/lib/review/schemas";
import { rpcErrorMessage } from "@/lib/supabase/rpc-error";
import { createClient } from "@/lib/supabase/server";
import { listMetrics } from "@/services/metrics";
import type { Database } from "@/types/database";

type EntryUpdate = Database["public"]["Tables"]["metric_entries"]["Update"];

const DECISIONS: Record<ReviewDecision, { update: (note: string) => EntryUpdate; message: string }> = {
  approve: { update: (note) => ({ status: "approved", review_note: note || null }), message: "Submission approved." },
  correction: {
    update: (note) => ({ status: "rejected", final_rejection: false, review_note: note }),
    message: "Correction requested. The employee can now edit and resubmit.",
  },
  reject: {
    update: (note) => ({ status: "rejected", final_rejection: true, review_note: note }),
    message: "Submission rejected.",
  },
};

/** Approve, request a correction or reject. The database enforces the allowed transitions. */
export async function reviewEntry(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const raw = readReview(formData);
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { note: raw.note } };
  const { entry_id, decision, note } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("metric_entries")
    .update(DECISIONS[decision].update(note))
    .eq("id", entry_id)
    .neq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error || !data) {
    const message = rpcErrorMessage(error, "This submission can't be changed from its current status. Refresh the page and try again.");
    return { status: "error", message, values: { note: raw.note } };
  }
  revalidatePath("/admin", "layout");
  return { status: "success", message: DECISIONS[decision].message };
}

/** Correct values of a submitted entry. Every change is audited by the database. */
export async function editEntryValues(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const entryId = z.uuid().safeParse(formData.get("entry_id"));
  if (!entryId.success) return { status: "error", message: "Unknown submission." };

  const supabase = await createClient();
  const { data: entry } = await supabase
    .from("metric_entries")
    .select("id, category, status")
    .eq("id", entryId.data)
    .neq("status", "draft")
    .maybeSingle();
  if (!entry) return { status: "error", message: "This submission no longer exists." };

  const { data: existing } = await supabase.from("metric_entry_values").select("metric_id, value, updated_at").eq("entry_id", entry.id);
  const current = new Map((existing ?? []).map((v) => [v.metric_id, v.value]));
  if (entryValuesVersion(existing ?? []) !== formData.get("version")) {
    return { status: "error", message: "These figures were changed by someone else while you were editing. Cancel, then check them and try again." };
  }
  const metrics = (await listMetrics(entry.category)).filter(
    (m) => m.kind === "input" && (m.is_active || current.has(m.id)),
  );

  const raw = Object.fromEntries(metrics.map((m) => [m.id, String(formData.get(m.id) ?? "")]));
  const { values, cleared, errors } = parseEntryValues(metrics, raw, { submitting: true });
  for (const id of cleared) {
    if (current.has(id) && !errors[id]) errors[id] = "Enter a value (submitted values can be changed, not removed)";
  }
  if (Object.keys(errors).length > 0) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: errors, values: raw };
  }

  const changed = Object.entries(values)
    .filter(([id, value]) => current.get(id) !== value)
    .map(([metric_id, value]) => ({ entry_id: entry.id, metric_id, value }));
  if (changed.length === 0) return { status: "success", message: "No changes to save." };

  const { error } = await supabase.from("metric_entry_values").upsert(changed, { onConflict: "entry_id,metric_id" });
  if (error) return { status: "error", message: rpcErrorMessage(error, "Could not save the changes. Please try again."), values: raw };

  revalidatePath("/admin", "layout");
  return { status: "success", message: `${changed.length} value${changed.length === 1 ? "" : "s"} updated and recorded in the audit trail.` };
}
