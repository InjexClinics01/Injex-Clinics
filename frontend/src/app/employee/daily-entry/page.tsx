import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { DailyEntryForm } from "@/components/metrics/daily-entry-form";
import { Card } from "@/components/ui/card";
import { requireEmployee } from "@/lib/auth/session";
import { categoryLabel } from "@/lib/constants";
import { formatDay, isIsoDate } from "@/lib/metrics/periods";
import { appToday, getEntry, listMetrics } from "@/services/metrics";

export const metadata: Metadata = { title: "Daily Entry" };

export default async function DailyEntryPage({ searchParams }: PageProps<"/employee/daily-entry">) {
  const profile = await requireEmployee();
  const today = appToday();
  const requested = (await searchParams).date;
  const date = isIsoDate(requested) && requested <= today ? requested : today;

  const category = profile.employee_category;
  const [metrics, entry] = category
    ? await Promise.all([listMetrics(category), getEntry(profile.id, date)])
    : [[], null];
  const active = metrics.filter((m) => m.is_active);

  return (
    <>
      <PageHeader title="Daily Entry" description={`${formatDay(date)} · ${categoryLabel(category)} form`} />
      {!active.some((m) => m.kind === "input") ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="Your daily form isn't set up yet"
            description={
              category
                ? "Your administrator hasn't configured the metrics for your role yet. Please check back later."
                : "You haven't been assigned a category yet. Please contact your administrator."
            }
          />
        </Card>
      ) : (
        <DailyEntryForm date={date} today={today} metrics={active} entry={entry} />
      )}
    </>
  );
}
