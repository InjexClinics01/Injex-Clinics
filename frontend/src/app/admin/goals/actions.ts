"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { metricKeyFromName, metricSchema, readMetric, readScoringRule, scoringRuleSchema } from "@/lib/metrics/schemas";
import { rpcErrorMessage } from "@/lib/supabase/rpc-error";
import { createClient } from "@/lib/supabase/server";

/** Create or update a metric definition. Category, key and kind are fixed after creation. */
export async function saveMetric(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const raw = readMetric(formData);
  const parsed = metricSchema.safeParse(raw);
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "boolean" ? (v ? "on" : "") : v]));
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };
  const m = parsed.data;

  const calculated = m.kind === "calculated";
  const fields = {
    name: m.name,
    description: m.description || null,
    data_type: m.data_type,
    unit: m.unit || null,
    aggregation: m.aggregation,
    min_value: calculated ? null : m.min_value,
    max_value: calculated ? null : m.max_value,
    default_target: m.default_target,
    is_required: !calculated && m.is_required,
    counts_as_unit: !calculated && m.counts_as_unit,
    numerator_metric_id: calculated && m.numerator !== "units" ? m.numerator : null,
    numerator_is_unit_total: calculated && m.numerator === "units",
    denominator_metric_id: calculated ? m.denominator_metric_id : null,
    is_goal_eligible: m.is_goal_eligible,
    is_scoring_eligible: m.is_scoring_eligible,
    sort_order: m.sort_order,
    is_active: m.is_active,
  };

  const supabase = await createClient();
  const { data, error } = m.id
    ? await supabase.from("metric_definitions").update(fields).eq("id", m.id).select("id").maybeSingle()
    : await supabase
        .from("metric_definitions")
        .insert({
          ...fields,
          category: m.category,
          kind: m.kind,
          key: await uniqueKey(m.category, metricKeyFromName(m.name)),
        })
        .select("id")
        .single();

  if (error) return { status: "error", message: errorMessage(error), values };
  if (!data) return { status: "error", message: "This metric no longer exists. Refresh the page.", values };
  revalidatePath("/admin/goals");
  return { status: "success", message: m.id ? "Metric updated." : "Metric added." };
}

export async function saveScoringRule(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const raw = readScoringRule(formData);
  const parsed = scoringRuleSchema.safeParse(raw);
  const values = { ...raw, is_active: raw.is_active ? "on" : "" };
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };
  const { id, metric_id, period, threshold, points, is_active } = parsed.data;

  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("scoring_rules").update({ period, threshold, points, is_active }).eq("id", id).select("id").maybeSingle()
    : await supabase.from("scoring_rules").insert({ metric_id, period, threshold, points, is_active }).select("id").single();

  if (error) {
    const message =
      error.code === "23505" ? "A rule with this metric, period and threshold already exists." : errorMessage(error);
    return { status: "error", message, values };
  }
  if (!data) return { status: "error", message: "This scoring rule no longer exists. Refresh the page.", values };
  revalidatePath("/admin/goals");
  return { status: "success", message: id ? "Scoring rule updated." : "Scoring rule added." };
}

async function uniqueKey(category: string, base: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("metric_definitions").select("key").eq("category", category).like("key", `${base}%`);
  const taken = new Set((data ?? []).map((r) => r.key));
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return key;
}

function errorMessage(error: { code?: string; message: string }) {
  if (error.code === "23505") return "A metric with this name already exists in this category.";
  return rpcErrorMessage(error, "Could not save. Please check the values and try again.");
}
