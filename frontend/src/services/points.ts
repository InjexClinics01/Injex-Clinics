import "server-only";

import { after } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { fetchPage } from "@/lib/utils/fetch-page";
import type { PendingAward, PointsBalance, PointsKind, PointsTransaction, RedemptionStatus, Reward, RewardRedemption } from "@/types/database";

/**
 * Phase 4 data access. Balances, crediting and redemptions are computed by the
 * database; this module only reads, and calls the RPCs that check permissions.
 */

/**
 * Credit any periods that have finished since the last visit. Idempotent: the
 * database credits each period once. Admins sync everyone, employees themselves.
 *
 * Runs after the response so pages never wait for it (reviews credit their
 * period straight away; this only catches periods ending with time passing, so
 * those appear on the next page load). A failure is logged and retried next visit.
 */
export async function syncPointsAfterResponse(): Promise<void> {
  const supabase = await createClient();
  after(async () => {
    const { error } = await supabase.rpc("sync_points");
    if (error) console.error(`Could not update points: ${error.message}`);
  });
}

const EMPTY_BALANCE = { balance: 0, lifetime_earned: 0, redeemed: 0, held: 0, available: 0 };

export async function getBalance(employeeId: string): Promise<Pick<PointsBalance, keyof typeof EMPTY_BALANCE>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("points_balances")
    .select("balance, lifetime_earned, redeemed, held, available")
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error) throw new Error(`Could not load points: ${error.message}`);
  return data ?? EMPTY_BALANCE;
}

/** All employees' balances (admins). */
export async function listBalances(): Promise<PointsBalance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("points_balances").select("*").order("full_name");
  if (error) throw new Error(`Could not load balances: ${error.message}`);
  return data;
}

/** Points earned but not credited yet. Employees: their own; admins: one employee or everyone. */
export async function listPendingPoints(employeeId?: string): Promise<PendingAward[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pending_points", employeeId ? { p_employee: employeeId } : {});
  if (error) throw new Error(`Could not load pending points: ${error.message}`);
  return data;
}

export const TRANSACTIONS_PAGE_SIZE = 25;

export async function listTransactions(filter: {
  employeeId?: string | null;
  kind?: PointsKind | null;
  page?: number;
  pageSize?: number;
}) {
  const supabase = await createClient();
  return fetchPage<PointsTransaction>(
    (from, to) => {
      let query = supabase.from("points_transactions").select("*", { count: "exact" }).order("created_at", { ascending: false });
      if (filter.employeeId) query = query.eq("employee_id", filter.employeeId);
      if (filter.kind) query = query.eq("kind", filter.kind);
      return query.range(from, to);
    },
    filter.page ?? 1,
    filter.pageSize ?? TRANSACTIONS_PAGE_SIZE,
  ).catch((e: Error) => {
    throw new Error(`Could not load transactions: ${e.message}`);
  });
}

/** Admins see every reward; employees see active ones (RLS). */
export async function listRewards(): Promise<Reward[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("rewards").select("*").order("sort_order").order("points_cost").order("name");
  if (error) throw new Error(`Could not load rewards: ${error.message}`);
  return data;
}

export type RedemptionRow = RewardRedemption & { employee: { full_name: string; email: string } | null };

export const REDEMPTIONS_PAGE_SIZE = 20;

export async function listRedemptions(filter: {
  employeeId?: string | null;
  statuses?: RedemptionStatus[];
  page?: number;
  pageSize?: number;
}) {
  const supabase = await createClient();
  return fetchPage<RedemptionRow>(
    (from, to) => {
      let query = supabase
        .from("reward_redemptions")
        .select("*, employee:profiles!reward_redemptions_employee_id_fkey(full_name, email)", { count: "exact" })
        .order("requested_at", { ascending: false });
      if (filter.employeeId) query = query.eq("employee_id", filter.employeeId);
      if (filter.statuses?.length) query = query.in("status", filter.statuses);
      return query.range(from, to) as unknown as PromiseLike<{
        data: RedemptionRow[] | null;
        error: { code?: string; message: string } | null;
        count: number | null;
      }>;
    },
    filter.page ?? 1,
    filter.pageSize ?? REDEMPTIONS_PAGE_SIZE,
  ).catch((e: Error) => {
    throw new Error(`Could not load redemptions: ${e.message}`);
  });
}

/** Reward ids the employee has a request waiting for (not limited by paging). */
export async function listPendingRewardIds(employeeId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("reward_redemptions").select("reward_id").eq("employee_id", employeeId).eq("status", "pending");
  if (error) throw new Error(`Could not load redemptions: ${error.message}`);
  return data.map((r) => r.reward_id);
}

export async function countRedemptions(status: RedemptionStatus): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("reward_redemptions").select("id", { count: "exact", head: true }).eq("status", status);
  if (error) throw new Error(`Could not count redemptions: ${error.message}`);
  return count ?? 0;
}
