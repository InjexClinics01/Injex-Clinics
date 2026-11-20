import { Target } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { CreateGoalDialog } from "@/components/metrics/create-goal-dialog";
import { GoalCard } from "@/components/metrics/goal-card";
import { Card } from "@/components/ui/card";
import { requireEmployee } from "@/lib/auth/session";
import { addDays } from "@/lib/metrics/periods";
import { estimateGoalPoints } from "@/lib/metrics/points";
import { appToday, listGoalProgress, listMetrics, listScoringRules } from "@/services/metrics";

export const metadata: Metadata = { title: "My Goals" };
export default async function GoalsPage() {
  const profile = await requireEmployee();
  const today = appToday();
  const [metrics, goals, rules] = await Promise.all([
    profile.employee_category ? listMetrics(profile.employee_category) : Promise.resolve([]),
    listGoalProgress(profile.id, addDays(today, -30)),
    listScoringRules(),
  ]);

  const eligible = metrics.filter((m) => m.is_active && m.is_goal_eligible);
  const metricById = new Map(metrics.map((m) => [m.id, m]));
  const current = goals.filter((g) => g.period_end >= today);
  const ended = goals.filter((g) => g.period_end < today);
  const points = (g: (typeof goals)[number]) => estimateGoalPoints(rules, g.metric_id, g.period, g.target_value).points;

  return (
    <>
      <PageHeader
        title="My Goals"
        description="Progress counts submitted entries (pending or approved)."
        actions={<CreateGoalDialog metrics={eligible} rules={rules} today={today} />}
      />

      {current.length === 0 ? (
        <Card>
          <EmptyState
            icon={Target}
            title="No active goals"
            description={
              eligible.length
                ? "Create a daily, weekly or monthly goal to track your progress."
                : "No metrics are available for goals yet. Please check back later."
            }
          />
        </Card>
      ) : (
        <section aria-label="Current goals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {current.map((g) => (
            <GoalCard key={g.goal_id} goal={g} metric={metricById.get(g.metric_id)} estimatedPoints={points(g)} cancellable />
          ))}
        </section>
      )}

      {ended.length > 0 && (
        <section aria-labelledby="ended-goals" className="mt-8">
          <h2 id="ended-goals" className="mb-3 text-sm font-semibold text-muted-foreground">
            Ended in the last 30 days
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {ended.map((g) => (
              <GoalCard key={g.goal_id} goal={g} metric={metricById.get(g.metric_id)} estimatedPoints={points(g)} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
