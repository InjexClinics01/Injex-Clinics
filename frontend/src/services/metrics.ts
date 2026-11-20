import "server-only";

import { todayIn } from "@/lib/metrics/periods";
import { createClient } from "@/lib/supabase/server";
import { fetchPage } from "@/lib/utils/fetch-page";
import { APP_TIME_ZONE } from "@/lib/utils/format";
import type { GoalProgress, MetricDefinition, MetricEntry, MetricEntryValue, ScoringRule } from "@/types/database";

/**
 * Phase 2 data access. Queries run as the signed-in user, so RLS limits
 * employees to their own category's metrics and their own entries and goals.
 */

export const appToday = () => todayIn(APP_TIME_ZONE);

export async function listMetrics(category: string): Promise<MetricDefinition[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("metric_definitions")
    .select("*")
    .eq("category", category)
    .order("sort_order")
    .order("name");
  if (error) throw new Error(`Could not load metrics: ${error.message}`);
  return data;
}

/** Every category's metrics (admins; RLS limits employees to their own category). */
export async function listAllMetrics(): Promise<MetricDefinition[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("metric_definitions").select("*").order("category").order("sort_order").order("name");
  if (error) throw new Error(`Could not load metrics: ${error.message}`);
  return data;
}

/** Rules the user can see: their category's for employees (RLS), everything for admins. */
export async function listScoringRules(): Promise<ScoringRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("scoring_rules").select("*").order("period").order("threshold");
  if (error) throw new Error(`Could not load scoring rules: ${error.message}`);
  return data;
}

export type EntryWithValues = MetricEntry & { values: MetricEntryValue[] };

/** Entries and their values in one request. */
const ENTRY_WITH_VALUES = "*, values:metric_entry_values(*)";

export async function getEntry(employeeId: string, date: string): Promise<EntryWithValues | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("metric_entries")
    .select(ENTRY_WITH_VALUES)
    .eq("employee_id", employeeId)
    .eq("entry_date", date)
    .maybeSingle();
  if (error) throw new Error(`Could not load entry: ${error.message}`);
  return data as EntryWithValues | null;
}

export const HISTORY_PAGE_SIZE = 30;

export async function listEntriesPage(employeeId: string, page: number) {
  const supabase = await createClient();
  return fetchPage<EntryWithValues>(
    (from, to) =>
      supabase
        .from("metric_entries")
        .select(ENTRY_WITH_VALUES, { count: "exact" })
        .eq("employee_id", employeeId)
        .order("entry_date", { ascending: false })
        .range(from, to) as unknown as PromiseLike<{
        data: EntryWithValues[] | null;
        error: { code?: string; message: string } | null;
        count: number | null;
      }>,
    page,
    HISTORY_PAGE_SIZE,
  ).catch((e: Error) => {
    throw new Error(`Could not load entries: ${e.message}`);
  });
}

export async function listEntries(employeeId: string, limit = 60): Promise<EntryWithValues[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("metric_entries")
    .select(ENTRY_WITH_VALUES)
    .eq("employee_id", employeeId)
    .order("entry_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load entries: ${error.message}`);
  return data as EntryWithValues[];
}

/** Active (not cancelled) goals ending on or after `endedSince`, with live progress. */
export async function listGoalProgress(employeeId: string, endedSince: string): Promise<GoalProgress[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("goal_progress")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("status", "active")
    .gte("period_end", endedSince)
    .order("period_end")
    .order("period");
  if (error) throw new Error(`Could not load goals: ${error.message}`);
  return data;
}

export async function getPeriodSummary(start: string, end: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_period_summary", { p_start: start, p_end: end });
  if (error) throw new Error(`Could not load summary: ${error.message}`);
  return new Map(data.map((row) => [row.metric_id, row]));
}
