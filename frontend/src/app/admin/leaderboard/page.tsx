import type { Metadata } from "next";
import { cookies } from "next/headers";

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
  const cookieStore = await cookies();
  const savedCategory = cookieStore.get("admin_category")?.value;
  const today = appToday();
  const period = parsePeriod(params);
  const day = parseDay(params, today);
  const categories = await listCategories();

  const slug = parseCategory(params);
  const requested = typeof params.category === "string"
    ? slug
    : (savedCategory && categories.some((c) => c.slug === savedCategory) ? savedCategory : categories[0]?.slug);
  const category = categories.some((c) => c.slug === requested) ? requested : categories[0]?.slug;

  const [metrics, rows, hallOfFameAwards, allProfiles] = await Promise.all([
    listAllMetrics(),
    getLeaderboard(period, day, category),
    listHallOfFameAwards(),
    listProfiles(),
  ]);
  const employees = allProfiles.filter((p) => p.is_active && p.role === "employee");
  const active = metrics.filter((m) => m.is_active && m.category === category);
  const rankBy = parseMetric(params);

  return (
    <>
      <PageHeader
        title="Leaderboard"
        description="Rankings from approved entries only. Compare within a category with points."
      />
      <LeaderboardView
        basePath="/admin/leaderboard"
        isAdmin
        viewerId={admin.id}
        period={period}
        day={day}
        today={today}
        category={category}
        /* Commented out Overall tab: keep Nurse and BT only */
        /* { slug: null, label: "Overall" }, */
        categories={categories.map((c) => ({ slug: c.slug, label: c.name }))}
        rows={rows}
        metrics={active}
        rankBy={active.some((m) => m.id === rankBy) ? rankBy : null}
        hallOfFameAwards={hallOfFameAwards}
        employees={employees}
      />
    </>
  );
}
