import { ArrowRight, CalendarCheck, Clock, Coins, Gift, PenLine, Target, UserRound } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/dashboard/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import { EntryStatusBadge } from "@/components/metrics/entry-status-badge";
import { ProgressBar } from "@/components/metrics/progress-bar";
import { MyRedemptions } from "@/components/points/my-redemptions";
import { TransactionList } from "@/components/points/transaction-list";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { categoryLabel } from "@/lib/constants";
import { PERIOD_LABELS, formatDay, formatPeriod } from "@/lib/metrics/periods";
import { estimateGoalPoints } from "@/lib/metrics/points";
import { formatMetricValue } from "@/lib/metrics/values";
import { formatPoints } from "@/lib/points/schemas";
import { cn } from "@/lib/utils";
import { firstName } from "@/lib/utils/format";
import type { EntryWithValues } from "@/services/metrics";
import type {
  GoalProgress,
  MetricDefinition,
  PointsBalance,
  PointsTransaction,
  Profile,
  Reward,
  RewardRedemption,
  ScoringRule,
} from "@/types/database";

export type EmployeeOverviewData = {
  today: string;
  weekStart: string;
  metrics: MetricDefinition[];
  entries: EntryWithValues[];
  goals: GoalProgress[];
  rules: ScoringRule[];
  weekSummary: Map<string, { value: number | null; entries_counted: number }>;
  points: Pick<PointsBalance, "available" | "held" | "lifetime_earned">;
  pendingPoints: number;
  transactions: PointsTransaction[];
  rewards: Reward[];
  redemptions: RewardRedemption[];
};

export function EmployeeOverview({ profile, data }: { profile: Profile; data: EmployeeOverviewData }) {
  const { today, weekStart, metrics, entries, goals, rules, weekSummary, points, pendingPoints, transactions, rewards, redemptions } = data;
  const metricById = new Map(metrics.map((m) => [m.id, m]));
  const todayEntry = entries.find((e) => e.entry_date === today);
  const pendingCount = entries.filter((e) => e.status === "pending").length;
  const goalPoints = goals.map((g) => ({ goal: g, points: estimateGoalPoints(rules, g.metric_id, g.period, g.target_value).points }));
  // Only approved entries count towards points (Phase 3 verification).
  const achieved = goalPoints.filter(({ goal }) => goal.verified_percent >= 100);
  const affordable = rewards.filter((r) => r.points_cost <= points.available && (r.stock === null || r.stock > 0));
  const summaryMetrics = metrics.filter((m) => m.is_active && (m.kind === "calculated" || m.is_required));

  return (
    <>
      <section className="mb-6 rounded-xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:mb-8 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Badge variant={profile.employee_category ? "secondary" : "outline"}>{categoryLabel(profile.employee_category)}</Badge>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Welcome, {firstName(profile.full_name)}</h1>
            <p className="text-sm text-muted-foreground">{formatDay(today)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/employee/daily-entry" className={buttonVariants()}>
              <PenLine /> {todayEntry ? "Open today's entry" : "Add today's entry"}
            </Link>
          </div>
        </div>
        {!profile.employee_category && (
          <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            Your account hasn&apos;t been assigned a category yet. Please ask your administrator to assign you as a Nurse or
            Beauty Therapist.
          </p>
        )}
      </section>

      <section aria-label="Your summary" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Today's entry"
          value={todayEntry ? <EntryStatusBadge status={todayEntry.status} finalRejection={todayEntry.final_rejection} /> : "Not started"}
          icon={CalendarCheck}
          muted={!todayEntry}
        />
        <StatCard label="Active goals" value={goals.length} icon={Target} hint={`${achieved.length} achieved (verified)`} muted={goals.length === 0} />
        <StatCard
          label="Points available"
          value={formatPoints(points.available)}
          icon={Coins}
          hint={`${formatPoints(pendingPoints)} pending · ${formatPoints(points.lifetime_earned)} lifetime`}
          muted={points.lifetime_earned === 0 && pendingPoints === 0}
        />
        <StatCard label="Awaiting review" value={pendingCount} icon={Clock} hint="Submitted entries" muted={pendingCount === 0} />
      </section>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>This week</CardTitle>
            <CardDescription>{formatPeriod("weekly", weekStart, today)} · submitted entries</CardDescription>
          </CardHeader>
          <CardContent>
            {summaryMetrics.length === 0 ? (
              <p className="text-sm text-muted-foreground">Your daily form hasn&apos;t been set up yet.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {summaryMetrics.map((m) => (
                  <div key={m.id} className="rounded-lg border bg-muted/30 p-3">
                    <dt className="truncate text-xs text-muted-foreground">{m.name}</dt>
                    <dd className="mt-1 font-semibold tabular-nums">
                      {formatMetricValue(weekSummary.get(m.id)?.value, m.data_type, m.unit)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>

        {/* Goal progress card commented out
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Goal progress</CardTitle>
              <CardDescription>Your current goals · includes entries awaiting review</CardDescription>
            </div>
            <Link href="/employee/goals" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              All goals <ArrowRight />
            </Link>
          </CardHeader>
          <CardContent>
            {goals.length === 0 ? (
              <EmptyState icon={Target} title="No active goals" description="Set a goal to start tracking progress." className="py-6" />
            ) : (
              <ul className="space-y-4">
                {goalPoints.slice(0, 5).map(({ goal, points }) => {
                  const m = metricById.get(goal.metric_id);
                  const fmt = (v: number) => formatMetricValue(v, m?.data_type ?? "decimal", m?.unit ?? null);
                  return (
                    <li key={goal.goal_id} className="space-y-1.5">
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="truncate font-medium">
                          {m?.name} <span className="font-normal text-muted-foreground">· {PERIOD_LABELS[goal.period]}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">{goal.percent_complete}%</span>
                      </div>
                      <ProgressBar percent={goal.percent_complete} label={`${m?.name} goal progress`} />
                      <p className="text-xs text-muted-foreground">
                        {fmt(goal.current_value ?? 0)} of {fmt(goal.target_value)}
                        {points > 0 && ` · est. ${points} pts`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        */}
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle>Recent entries</CardTitle>
            <CardDescription>Your latest daily submissions</CardDescription>
          </div>
          <Link href="/employee/history" className={buttonVariants({ variant: "outline", size: "sm" })}>
            History <ArrowRight className="size-4" />
          </Link>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState icon={CalendarCheck} title="No entries yet" description="Your daily entries will appear here." className="py-6" />
          ) : (
            <ul className="divide-y">
              {entries.slice(0, 5).map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/employee/daily-entry?date=${e.entry_date}`}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-primary"
                  >
                    <span>{formatDay(e.entry_date)}</span>
                    <EntryStatusBadge status={e.status} finalRejection={e.final_rejection} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="pb-0">
          <CardHeader className="flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Recently earned</CardTitle>
              <CardDescription>Credited once results are approved and the period ends</CardDescription>
            </div>
            <Link href="/employee/points" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              My points <ArrowRight />
            </Link>
          </CardHeader>
          <CardContent className="px-0">
            <TransactionList rows={transactions} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Rewards</CardTitle>
              <CardDescription>
                {affordable.length > 0
                  ? `${affordable.length} ${affordable.length === 1 ? "reward is" : "rewards are"} within reach`
                  : "Keep earning to unlock rewards"}
              </CardDescription>
            </div>
            <Link href="/employee/rewards" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Browse <ArrowRight />
            </Link>
          </CardHeader>
          <CardContent className="space-y-5">
            {rewards.length === 0 ? (
              <EmptyState icon={Gift} title="No rewards yet" description="Your administrator hasn't added any rewards." className="py-6" />
            ) : (
              <ul className="space-y-2">
                {rewards.slice(0, 4).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{r.name}</span>
                    <span className={cn("shrink-0 tabular-nums", r.points_cost <= points.available ? "font-medium text-success" : "text-muted-foreground")}>
                      {formatPoints(r.points_cost)} pts
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {redemptions.length > 0 && (
              <div className="space-y-3 border-t pt-4">
                <p className="text-xs font-medium text-muted-foreground">Your recent requests</p>
                <MyRedemptions rows={redemptions} compact />
              </div>
            )}
          </CardContent>
        </Card>
      </div> */}
    </>
  );
}
