import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { LeaderboardView } from "@/components/performance/leaderboard-view";
import { requireAdmin } from "@/lib/auth/session";
import { parseCategory, parseDay, parseMetric, parsePeriod } from "@/lib/performance/filters";
import { listCategories, listProfiles } from "@/services/employees";
import { listHallOfFameAwards } from "@/services/hall-of-fame";
import { appToday, listAllMetrics } from "@/services/metrics";
import { getLeaderboard } from "@/services/performance";

export const metadata: Metadata = { title: "Leaderboard" };

export default async function AdminLeaderboardPage({ searchParams }: PageProps<"/admin/leaderboard">) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const today = appToday();
  const period = parsePeriod(params);
  const day = parseDay(params, today);
  const slug = parseCategory(params);
  const requested = slug === "overall" ? null : slug;
  const [categories, metrics, requestedRows, hallOfFameAwards, allProfiles] = await Promise.all([
    listCategories(),
    listAllMetrics(),
    getLeaderboard(period, day, requested),
    listHallOfFameAwards(),
    listProfiles(),
  ]);
  const employees = allProfiles.filter((p) => p.is_active && p.role === "employee");
  // An unknown category in the URL falls back to the overall board.
  const category = categories.some((c) => c.slug === requested) ? requested : null;
  const rows = category === requested ? requestedRows : await getLeaderboard(period, day, null);
  const active = metrics.filter((m) => m.is_active && m.category === category);
  const rankBy = parseMetric(params);

  return (
    <>
      <PageHeader
        title="Leaderboard"
        description="Rankings from approved entries only. Compare within a category, or across categories with normalised points."
      />
      <LeaderboardView
        basePath="/admin/leaderboard"
        isAdmin
        viewerId={admin.id}
        period={period}
        day={day}
        today={today}
        category={category}
        categories={[{ slug: null, label: "Overall" }, ...categories.map((c) => ({ slug: c.slug, label: c.name }))]}
        rows={rows}
        metrics={active}
        rankBy={active.some((m) => m.id === rankBy) ? rankBy : null}
        hallOfFameAwards={hallOfFameAwards}
        employees={employees}
      />
    </>
  );
}
