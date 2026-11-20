// Relative import (not "@/") so `node --test` can load this module directly.
import { addDays, daysBetween, isIsoDate } from "../metrics/periods.ts";
import { parsePage } from "../utils/fetch-page.ts";
import type { GoalPeriod } from "@/types/database";

/**
 * URL search-param parsing for the review queue, leaderboard, progress and
 * report pages. Anything unexpected falls back to a safe default, so a
 * hand-edited URL can never reach the database unvalidated.
 */

type Params = Record<string, string | string[] | undefined>;

const one = (params: Params, key: string) => {
  const v = params[key];
  return typeof v === "string" ? v.trim() : "";
};
export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isCategory = (v: string) => /^[a-z][a-z0-9_]{1,49}$/.test(v);
const PERIODS: GoalPeriod[] = ["daily", "weekly", "monthly"];

export function parsePeriod(params: Params, fallback: GoalPeriod = "weekly"): GoalPeriod {
  const v = one(params, "period");
  return PERIODS.includes(v as GoalPeriod) ? (v as GoalPeriod) : fallback;
}

/** A date no later than today (defaults to today). */
export function parseDay(params: Params, today: string, key = "date"): string {
  const v = one(params, key);
  return isIsoDate(v) && v <= today ? v : today;
}

export function parseCategory(params: Params): string | null {
  const v = one(params, "category");
  return isCategory(v) ? v : null;
}

export function parseEmployee(params: Params): string | null {
  const v = one(params, "employee");
  return isUuid(v) ? v : null;
}

export function parseMetric(params: Params): string | null {
  const v = one(params, "metric");
  return isUuid(v) ? v : null;
}

// -----------------------------------------------------------------------------
// Review queue
// -----------------------------------------------------------------------------
export const SUBMISSION_TABS = ["pending", "correction", "rejected", "approved", "all"] as const;
export type SubmissionTab = (typeof SUBMISSION_TABS)[number];
export const SUBMISSIONS_PAGE_SIZE = 20;

export type SubmissionFilters = {
  tab: SubmissionTab;
  category: string | null;
  employee: string | null;
  q: string;
  from: string | null;
  to: string | null;
  page: number;
  /** Tells the user why a date they entered was not used. */
  notice: string | null;
};

export function parseSubmissionFilters(params: Params): SubmissionFilters {
  const tab = one(params, "tab");
  const rawFrom = one(params, "from");
  const rawTo = one(params, "to");
  const from = isIsoDate(rawFrom) ? rawFrom : null;
  const to = isIsoDate(rawTo) ? rawTo : null;
  const reversed = from !== null && to !== null && from > to;
  const invalid = (rawFrom !== "" && !from) || (rawTo !== "" && !to);
  return {
    tab: SUBMISSION_TABS.includes(tab as SubmissionTab) ? (tab as SubmissionTab) : "pending",
    category: parseCategory(params),
    employee: parseEmployee(params),
    q: one(params, "q").slice(0, 80),
    from: reversed ? null : from,
    to: reversed ? null : to,
    page: parsePage(params.page),
    notice: reversed
      ? "The From date was after the To date, so the date filter was ignored."
      : invalid
        ? "A date wasn't valid, so it was ignored."
        : null,
  };
}

// -----------------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------------
export const REPORT_MAX_DAYS = 366;

export type ReportFilters = {
  from: string;
  to: string;
  category: string | null;
  employee: string | null;
  /** Tells the user why the dates shown differ from the ones they entered. */
  notice: string | null;
};

/** Defaults to the last 30 days. The range is capped at a year and never ends after today. */
export function parseReportFilters(params: Params, today: string): ReportFilters {
  const rawTo = one(params, "to");
  const rawFrom = one(params, "from");
  const notices: string[] = [];

  const to = isIsoDate(rawTo) && rawTo <= today ? rawTo : today;
  if (rawTo && to !== rawTo) notices.push("The end date wasn't valid or was in the future, so today is used.");

  let from = addDays(to, -29);
  if (rawFrom && !isIsoDate(rawFrom)) notices.push("The start date wasn't valid, so the last 30 days are shown.");
  else if (rawFrom && rawFrom > to) notices.push("The start date was after the end date, so the last 30 days are shown.");
  else if (rawFrom) from = rawFrom;

  if (daysBetween(from, to) >= REPORT_MAX_DAYS) {
    from = addDays(to, -(REPORT_MAX_DAYS - 1));
    notices.push(`Reports cover up to ${REPORT_MAX_DAYS} days, so the start date was moved.`);
  }
  return { from, to, category: parseCategory(params), employee: parseEmployee(params), notice: notices.join(" ") || null };
}
