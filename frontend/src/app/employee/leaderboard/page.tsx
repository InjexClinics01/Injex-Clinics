import { Trophy } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { LeaderboardView } from "@/components/performance/leaderboard-view";
import { Card } from "@/components/ui/card";
import { requireEmployee } from "@/lib/auth/session";
import { categoryLabel } from "@/lib/constants";
import { parseDay, parsePeriod } from "@/lib/performance/filters";
import { listHallOfFameAwards } from "@/services/hall-of-fame";
import { appToday, listMetrics } from "@/services/metrics";
import { getAppSettings, getLeaderboard } from "@/services/performance";

export const metadata: Metadata = { title: "Leaderboard" };

export default async function EmployeeLeaderboardPage({ searchParams }: PageProps<"/employee/leaderboard">) {
  const profile = await requireEmployee();
  const own = profile.employee_category;
  const header = <PageHeader title="Leaderboard" description="See where you rank. Only approved entries count." />;
  if (!own) {
    return (
      <>
        {header}
        <Card>
          <EmptyState icon={Trophy} title="No leaderboard yet" description="You haven't been assigned a category. Please contact your administrator." />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const today = appToday();
  const period = parsePeriod(params);
  const day = parseDay(params, today);
  const wantsOverall = params.category === "overall";
  const [settings, metrics, ownRows, hallOfFameAwards] = await Promise.all([
    getAppSettings(),
    listMetrics(own),
    wantsOverall ? null : getLeaderboard(period, day, own),
    listHallOfFameAwards(),
  ]);
  // The database also refuses the overall board unless an admin has enabled it.
  const category = wantsOverall && settings.overall_leaderboard_enabled ? null : own;
  const rows = ownRows ?? (await getLeaderboard(period, day, category));

  return (
    <>
      {header}
      <LeaderboardView
        basePath="/employee/leaderboard"
        isAdmin={false}
        viewerId={profile.id}
        period={period}
        day={day}
        today={today}
        category={category}
        categories={[
          { slug: own, label: categoryLabel(own) },
          ...(settings.overall_leaderboard_enabled ? [{ slug: null, label: "Overall" }] : []),
        ]}
        rows={rows}
        metrics={category ? metrics.filter((m) => m.is_active) : []}
        rankBy={null}
        hallOfFameAwards={hallOfFameAwards}
      />
    </>
  );
}
