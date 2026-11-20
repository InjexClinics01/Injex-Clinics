import type { Metadata } from "next";

import { EmployeeOverview } from "@/components/dashboard/employee-overview";
import { requireEmployee } from "@/lib/auth/session";
import { periodStart } from "@/lib/metrics/periods";
import { totalPendingPoints } from "@/lib/points/schemas";
import { appToday, getPeriodSummary, listEntries, listGoalProgress, listMetrics, listScoringRules } from "@/services/metrics";
import { getBalance, listPendingPoints, listRedemptions, listRewards, listTransactions, syncPointsAfterResponse } from "@/services/points";

export const metadata: Metadata = { title: "My dashboard" };

export default async function EmployeeDashboardPage() {
  const profile = await requireEmployee();
  const today = appToday();
  const weekStart = periodStart("weekly", today);
  await syncPointsAfterResponse();

  const [metrics, entries, goals, rules, weekSummary, points, pending, { rows: transactions }, rewards, { rows: redemptions }] = await Promise.all([
    profile.employee_category ? listMetrics(profile.employee_category) : Promise.resolve([]),
    listEntries(profile.id, 30),
    listGoalProgress(profile.id, today),
    listScoringRules(),
    getPeriodSummary(weekStart, today),
    getBalance(profile.id),
    listPendingPoints(),
    listTransactions({ employeeId: profile.id, pageSize: 5 }),
    listRewards(),
    listRedemptions({ employeeId: profile.id, pageSize: 3 }),
  ]);
  const pendingPoints = totalPendingPoints(pending);

  return (
    <EmployeeOverview
      profile={profile}
      data={{ today, weekStart, metrics, entries, goals, rules, weekSummary, points, pendingPoints, transactions, rewards, redemptions }}
    />
  );
}
