import type { GoalPeriod } from "@/types/database";

/**
 * Date helpers working on ISO dates ("2026-11-04"), the format Postgres `date`
 * columns use. Must match private.period_start/period_end in the database:
 * weeks run Monday–Sunday.
 */

export const PERIOD_LABELS: Record<GoalPeriod, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  return toDate(value).toISOString().slice(0, 10) === value; // rejects 2026-02-30
}

/** Today's date in the business time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function periodStart(period: GoalPeriod, iso: string): string {
  const d = toDate(iso);
  if (period === "weekly") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (period === "monthly") d.setUTCDate(1);
  return toIso(d);
}

export function periodEnd(period: GoalPeriod, start: string): string {
  if (period === "daily") return start;
  if (period === "weekly") return addDays(start, 6);
  const d = toDate(start);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function nextPeriodStart(period: GoalPeriod, iso: string): string {
  return addDays(periodEnd(period, periodStart(period, iso)), 1);
}

/** Start of the period `delta` periods before (negative) or after (positive) the one containing `iso`. */
export function shiftPeriod(period: GoalPeriod, iso: string, delta: number): string {
  let start = periodStart(period, iso);
  for (let i = 0; i < Math.abs(delta); i++) {
    start = delta > 0 ? nextPeriodStart(period, start) : periodStart(period, addDays(start, -1));
  }
  return start;
}

/** Start dates of the `count` periods ending with the one containing `iso`, oldest first. */
export function recentPeriods(period: GoalPeriod, iso: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftPeriod(period, iso, i - count + 1));
}

/** Whole days from `from` to `to` (0 when equal). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);
}

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** Short chart-axis label for a period starting on `start`: "4 Nov" (day / week start) or "Nov 2026". */
export function formatBucket(period: GoalPeriod, start: string): string {
  return period === "monthly" ? monthShort.format(toDate(start)) : shortDate.format(toDate(start));
}

/** "Wed 4 Nov 2026" */
export function formatDay(iso: string): string {
  return longDate.format(toDate(iso));
}

/** "4 Nov", "3 Nov – 9 Nov", "November 2026" */
export function formatPeriod(period: GoalPeriod, start: string, end: string): string {
  if (period === "daily") return shortDate.format(toDate(start));
  if (period === "monthly") return monthYear.format(toDate(start));
  return `${shortDate.format(toDate(start))} – ${shortDate.format(toDate(end))}`;
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
