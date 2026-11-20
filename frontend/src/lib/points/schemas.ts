import { z } from "zod";

import type { PendingAward, PointsKind, RedemptionStatus } from "@/types/database";

/**
 * Validation (browser + server) and labels for points, rewards and redemptions.
 * The database re-checks every rule; these give instant, friendly feedback.
 */

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const BINARY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const wholeNumber = (min: number, max: number, message: string) =>
  z
    .string()
    .min(1, "Required")
    .transform((v) => Number(v.replace(/,/g, "")))
    .refine((v) => Number.isInteger(v) && v >= min && v <= max, message);

// -----------------------------------------------------------------------------
// Rewards (admin)
// -----------------------------------------------------------------------------
export const rewardSchema = z.object({
  id: z.union([z.literal(""), z.uuid()]),
  name: z
    .string()
    .min(2, "Enter a name (at least 2 characters)")
    .max(80, "Name must be 80 characters or fewer")
    .refine((v) => !/[\u0000-\u001F\u007F]/.test(v), "Name contains invalid characters"),
  description: z.string().max(500, "Description must be 500 characters or fewer").refine((v) => !BINARY.test(v), "Invalid characters"),
  points_cost: wholeNumber(1, 1_000_000, "Enter whole points between 1 and 1,000,000"),
  stock: z
    .string()
    .transform((v) => (v === "" ? null : Number(v.replace(/,/g, ""))))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 1_000_000), "Enter a whole number of 0 or more, or leave empty for unlimited"),
  is_active: z.boolean(),
});

export const readReward = (fd: FormData) => ({
  id: str(fd, "id"),
  name: str(fd, "name").replace(/\s+/g, " "),
  description: str(fd, "description"),
  points_cost: str(fd, "points_cost"),
  stock: str(fd, "stock"),
  is_active: fd.get("is_active") === "on",
});

// -----------------------------------------------------------------------------
// Manual adjustments (admin)
// -----------------------------------------------------------------------------
export const adjustmentSchema = z.object({
  employee_id: z.uuid({ error: "Choose an employee" }),
  amount: z
    .string()
    .min(1, "Required")
    .transform((v) => Number(v.replace(/,/g, "")))
    .refine((v) => Number.isInteger(v) && v !== 0 && Math.abs(v) <= 100_000, "Enter whole points between -100,000 and 100,000 (not 0)"),
  reason: z
    .string()
    .min(5, "Give a reason (at least 5 characters). It is shown to the employee and kept in the audit log")
    .max(300, "Keep the reason to 300 characters or fewer")
    .refine((v) => !BINARY.test(v), "Reason contains invalid characters"),
});

export const readAdjustment = (fd: FormData) => ({
  employee_id: str(fd, "employee_id"),
  amount: str(fd, "amount"),
  reason: str(fd, "reason"),
});

// -----------------------------------------------------------------------------
// Redemption decisions (admin)
// -----------------------------------------------------------------------------
export const REDEMPTION_DECISIONS = ["approve", "reject", "fulfil", "refund"] as const;

export const redemptionDecisionSchema = z
  .object({
    redemption_id: z.uuid({ error: "Unknown request" }),
    decision: z.enum(REDEMPTION_DECISIONS, { error: "Choose a decision" }),
    note: z.string().max(500, "Keep the note to 500 characters or fewer").refine((v) => !BINARY.test(v), "Invalid characters"),
  })
  .refine((v) => !["reject", "refund"].includes(v.decision) || v.note.length >= 3, {
    path: ["note"],
    message: "Give a reason (at least 3 characters). The employee will see it",
  });

export const readRedemptionDecision = (fd: FormData) => ({
  redemption_id: str(fd, "redemption_id"),
  decision: str(fd, "decision"),
  note: str(fd, "note"),
});

// -----------------------------------------------------------------------------
// Points settings (admin)
// -----------------------------------------------------------------------------
export const pointsSettingsSchema = z.object({
  points_start_date: z.iso.date({ error: "Choose a date" }),
  streak_enabled: z.boolean(),
  streak_min_days: wholeNumber(1, 7, "Between 1 and 7 days"),
  streak_weeks: wholeNumber(1, 52, "Between 1 and 52 weeks"),
  streak_points: wholeNumber(1, 100_000, "Between 1 and 100,000 points"),
});

export const readPointsSettings = (fd: FormData) => ({
  points_start_date: str(fd, "points_start_date"),
  streak_enabled: fd.get("streak_enabled") === "on",
  streak_min_days: str(fd, "streak_min_days"),
  streak_weeks: str(fd, "streak_weeks"),
  streak_points: str(fd, "streak_points"),
});

// -----------------------------------------------------------------------------
// Labels and totals
// -----------------------------------------------------------------------------
export const POINTS_KIND_LABELS: Record<PointsKind, string> = {
  performance: "Performance",
  goal: "Goal achieved",
  streak: "Streak bonus",
  correction: "Correction",
  adjustment: "Adjustment",
  redemption: "Redeemed",
  refund: "Refund",
};

export const REDEMPTION_STATUS_LABELS: Record<RedemptionStatus, string> = {
  pending: "Awaiting approval",
  approved: "Approved · to hand over",
  rejected: "Rejected",
  fulfilled: "Received",
  cancelled: "Cancelled",
};

/** Admin redemption queue tabs. */
export const REDEMPTION_TABS = {
  pending: { label: "To approve", statuses: ["pending"] },
  approved: { label: "To hand over", statuses: ["approved"] },
  done: { label: "Completed", statuses: ["fulfilled", "rejected", "cancelled"] },
} as const satisfies Record<string, { label: string; statuses: RedemptionStatus[] }>;
export type RedemptionTab = keyof typeof REDEMPTION_TABS;

/** "+120" / "−50" with a thousands separator. */
export function formatPoints(amount: number, signed = false): string {
  const text = new Intl.NumberFormat("en-GB").format(Math.abs(amount));
  if (!signed) return amount < 0 ? `−${text}` : text;
  return amount > 0 ? `+${text}` : amount < 0 ? `−${text}` : "0";
}

export function totalPendingPoints(awards: Pick<PendingAward, "points">[]): number {
  return awards.reduce((sum, a) => sum + a.points, 0);
}

/** Why a reward cannot be requested right now (null = it can). */
export function redeemBlocker(
  reward: { points_cost: number; stock: number | null; is_active: boolean },
  available: number,
  hasPendingRequest: boolean,
): string | null {
  if (!reward.is_active) return "No longer available";
  if (reward.stock !== null && reward.stock <= 0) return "Out of stock";
  if (hasPendingRequest) return "Request waiting for approval";
  if (available < reward.points_cost) return `${formatPoints(reward.points_cost - available)} more points needed`;
  return null;
}
