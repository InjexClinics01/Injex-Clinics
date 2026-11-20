import { History } from "lucide-react";

import { categoryLabel } from "@/lib/constants";
import { formatDay } from "@/lib/metrics/periods";
import { formatDateTime } from "@/lib/utils/format";
import type { ActivityItem } from "@/services/employees";
import type { Profile } from "@/types/database";
import { EmptyState } from "./empty-state";

type Change = { from: unknown; to: unknown };
type Details = {
  email?: string;
  employee_id?: string;
  entry_date?: string;
  note?: string | null;
  metric_name?: string;
  from?: unknown;
  to?: unknown;
  changes?: Record<string, Change>;
  values?: Record<string, unknown>;
  amount?: number;
  reason?: string;
  reward_name?: string;
  points_cost?: number;
};

const ENTRY_ACTIONS: Record<string, string> = {
  "entry.submitted": "submitted",
  "entry.resubmitted": "resubmitted after a correction",
  "entry.withdrawn": "moved back to draft",
  "entry.approved": "approved",
  "entry.rejected": "rejected",
  "entry.correction_requested": "sent back for correction",
};

const REDEMPTION_ACTIONS: Record<string, string> = {
  "redemption.requested": "requested",
  "redemption.cancelled": "cancelled by the employee",
  "redemption.approved": "approved (points deducted)",
  "redemption.rejected": "rejected",
  "redemption.fulfilled": "handed over",
  "redemption.refunded": "refunded",
};

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "empty" : String(v));

function describe(item: ActivityItem, profilesById: Map<string, Profile>, metricsById: Map<string, { name: string }>, inEntry: boolean) {
  const details = (item.details ?? {}) as Details;
  const person = (id?: string | null) => {
    const p = id ? profilesById.get(id) : undefined;
    return p?.full_name || p?.email || details.email || "a user";
  };
  const entryRef = `${person(details.employee_id)}'s entry for ${details.entry_date ? formatDay(details.entry_date) : "a day"}`;

  if (ENTRY_ACTIONS[item.action]) {
    const text = inEntry ? capitalise(ENTRY_ACTIONS[item.action]) : `${entryRef} ${ENTRY_ACTIONS[item.action]}`;
    return details.note && !["entry.submitted", "entry.resubmitted", "entry.withdrawn"].includes(item.action)
      ? `${text}: “${details.note}”`
      : text;
  }
  if (item.action === "entry.value_edited_by_admin" || item.action === "entry.value_corrected") {
    const change = `${details.metric_name}: ${show(details.from)} → ${show(details.to)}`;
    const who = item.action === "entry.value_edited_by_admin" ? "Admin edit" : "Employee correction";
    return inEntry ? `${who} · ${change}` : `${who} on ${entryRef} · ${change}`;
  }
  if (item.action.startsWith("metric_definition.")) {
    const name = metricsById.get(item.entity_id ?? "")?.name ?? String(details.values?.name ?? "a metric");
    return item.action.endsWith(".created") ? `Metric “${name}” added` : `Metric “${name}” updated: ${changeList(details.changes)}`;
  }
  if (item.action.startsWith("scoring_rule.")) {
    return item.action.endsWith(".created")
      ? `Scoring rule added: ${show(details.values?.threshold)} → ${show(details.values?.points)} pts (${show(details.values?.period)})`
      : `Scoring rule updated: ${changeList(details.changes)}`;
  }
  if (item.action === "points.adjusted") {
    const amount = Number(details.amount ?? 0);
    return `Points adjusted for ${person(details.employee_id)}: ${amount > 0 ? "+" : ""}${amount} (“${details.reason}”)`;
  }
  if (REDEMPTION_ACTIONS[item.action]) {
    const text = `${person(details.employee_id)}'s request for ${details.reward_name} (${details.points_cost} pts) ${REDEMPTION_ACTIONS[item.action]}`;
    return details.note ? `${text}: “${details.note}”` : text;
  }
  if (item.action.startsWith("reward.")) {
    const name = String(details.values?.name ?? details.changes?.name?.to ?? "");
    return item.action.endsWith(".created")
      ? `Reward “${name}” added (${show(details.values?.points_cost)} pts)`
      : `Reward${name ? ` “${name}”` : ""} updated: ${changeList(details.changes)}`;
  }
  if (item.action === "app_settings.updated") {
    const enabled = details.changes?.overall_leaderboard_enabled?.to;
    return enabled === undefined
      ? `Settings updated: ${changeList(details.changes)}`
      : `Overall leaderboard ${enabled ? "shown to" : "hidden from"} employees`;
  }

  const who = person(item.entity_id);
  if (item.action === "profile.created") return `Account created for ${who}`;
  if (item.action === "profile.invited") return `Invitation sent to ${who}`;
  if (item.action === "profile.created_by_admin") return `Account set up for ${who}`;
  if (item.action === "profile.updated") {
    const changes = details.changes ?? {};
    const parts: string[] = [];
    if (changes.role) parts.push(`role → ${String(changes.role.to)}`);
    if (changes.employee_category) parts.push(`category → ${categoryLabel(changes.employee_category.to as string | null)}`);
    if (changes.is_active) parts.push(changes.is_active.to ? "reactivated" : "deactivated");
    if (changes.full_name) parts.push("name updated");
    if (changes.email) parts.push("email updated");
    return `${who}: ${parts.join(", ") || "profile updated"}`;
  }
  return `${item.action} (${item.entity_type})`;
}

function changeList(changes: Record<string, Change> | undefined) {
  const entries = Object.entries(changes ?? {});
  if (entries.length === 0) return "no details";
  return entries.map(([key, c]) => `${key.replace(/_/g, " ")} ${show(c.from)} → ${show(c.to)}`).join(", ");
}

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ActivityList({
  items,
  profilesById,
  metricsById = new Map(),
  inEntry = false,
  emptyText = "Changes will appear here.",
}: {
  items: ActivityItem[];
  profilesById: Map<string, Profile>;
  metricsById?: Map<string, { name: string }>;
  /** Shown on a submission's own page: omit "Nina's entry for …". */
  inEntry?: boolean;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return <EmptyState icon={History} title="No activity yet" description={emptyText} className="py-8" />;
  }
  return (
    <ol className="divide-y">
      {items.map((item) => {
        const actor = item.actor?.full_name || item.actor?.email || "System";
        return (
          <li key={item.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
            <p className="text-sm break-words">{describe(item, profilesById, metricsById, inEntry)}</p>
            <p className="text-xs text-muted-foreground">
              {actor} · <time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
