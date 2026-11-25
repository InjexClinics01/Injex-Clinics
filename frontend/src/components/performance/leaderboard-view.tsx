import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Medal, Target, Trophy } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/dashboard/empty-state";
import { LinkSelect } from "@/components/forms/link-select";
import { ProgressBar } from "@/components/metrics/progress-bar";
import { HallOfFameCard } from "@/components/performance/hall-of-fame-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { categoryLabel } from "@/lib/constants";
import { PERIOD_LABELS, formatPeriod, periodEnd, periodStart, shiftPeriod } from "@/lib/metrics/periods";
import { formatMetricValue, headlineMetrics } from "@/lib/metrics/values";
import { metricScore, normalizedScore, rankRows } from "@/lib/performance/ranking";
import { cn } from "@/lib/utils";
import type { GoalPeriod, HallOfFameAward, LeaderboardRow, MetricDefinition, Profile } from "@/types/database";

export type LeaderboardViewProps = {
  basePath: "/admin/leaderboard" | "/employee/leaderboard";
  isAdmin: boolean;
  viewerId: string;
  period: GoalPeriod;
  day: string;
  today: string;
  /** null = overall (all categories, normalised points). */
  category: string | null;
  categories: { slug: string | null; label: string }[];
  rows: LeaderboardRow[];
  /** Metrics of the selected category (empty for the overall board). */
  metrics: MetricDefinition[];
  /** Admins only: rank by this metric instead of points. */
  rankBy: string | null;
  hallOfFameAwards?: HallOfFameAward[];
  employees?: Pick<Profile, "id" | "full_name" | "employee_category">[];
};

type Query = { period: GoalPeriod; date: string; category: string | null; metric: string | null };

function hrefFor(basePath: string, q: Query) {
  const params = new URLSearchParams({ period: q.period, date: q.date });
  if (q.category) params.set("category", q.category);
  else params.set("category", "overall");
  if (q.metric) params.set("metric", q.metric);
  return `${basePath}?${params}`;
}

export function LeaderboardView(props: LeaderboardViewProps) {
  const {
    basePath,
    isAdmin,
    viewerId,
    period,
    day,
    today,
    category,
    categories,
    rows,
    metrics,
    rankBy,
    hallOfFameAwards,
    employees,
  } = props;
  const start = periodStart(period, day);
  const isCurrent = start === periodStart(period, today);
  const overall = category === null;
  const hallOfFameSet = new Set((hallOfFameAwards ?? []).map((a) => a.employee_id));

  const rankMetric = rankBy ? metrics.find((m) => m.id === rankBy) : undefined;
  const ranked = rankRows(
    rows,
    (r) => (rankMetric ? metricScore(r, rankMetric.id) : overall ? normalizedScore(r) : r.points),
    (a, b) => {
      // 1. Hall of Fame recipient ranks higher on ties
      const aHof = hallOfFameSet.has(a.employee_id) ? 1 : 0;
      const bHof = hallOfFameSet.has(b.employee_id) ? 1 : 0;
      if (bHof !== aHof) return bHof - aHof;

      // 2. More goals achieved ranks higher
      if (b.goals_achieved !== a.goals_achieved) return b.goals_achieved - a.goals_achieved;

      // 3. More approved days ranks higher
      if (b.approved_days !== a.approved_days) return b.approved_days - a.approved_days;

      // 4. Higher raw metric values rank higher on ties
      const aRaw = Object.values(a.metric_values ?? {}).reduce<number>((acc, v) => acc + (Number(v) || 0), 0);
      const bRaw = Object.values(b.metric_values ?? {}).reduce<number>((acc, v) => acc + (Number(v) || 0), 0);
      if (bRaw !== aRaw) return bRaw - aRaw;

      return 0;
    },
  );
  const noRules = rows.length > 0 && rows.every((r) => r.max_points === 0);
  const query: Query = { period, date: start, category, metric: rankMetric?.id ?? null };
  const own = rows.find((r) => r.employee_id === viewerId);

  const suggestedTitle =
    period === "monthly"
      ? "Employee of the Month"
      : period === "weekly"
        ? "Employee of the Week"
        : "Employee of the Day";

  return (
    <div className="space-y-6">
      <HallOfFameCard
        awards={hallOfFameAwards ?? []}
        isAdmin={isAdmin}
        employees={employees}
        suggestedEmployeeId={rows[0]?.employee_id}
        suggestedPeriod={formatPeriod(period, start, periodEnd(period, start))}
        suggestedTitle={suggestedTitle}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <nav aria-label="Leaderboard" className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
            {categories.map((c) => (
              <Link
                key={c.slug ?? "overall"}
                href={hrefFor(basePath, { ...query, category: c.slug, metric: null })}
                prefetch={true}
                aria-current={c.slug === category ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                  c.slug === category && "bg-background text-foreground shadow-sm",
                )}
              >
                {c.label}
              </Link>
            ))}
          </nav>
          <nav aria-label="Period" className="flex gap-1 rounded-lg bg-muted p-1">
            {(["daily", "weekly", "monthly"] as const).map((p) => (
              <Link
                key={p}
                href={hrefFor(basePath, { ...query, period: p, date: today })}
                prefetch={true}
                aria-current={p === period ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                  p === period && "bg-background text-foreground shadow-sm",
                )}
              >
                {PERIOD_LABELS[p]}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {isAdmin && !overall && metrics.length > 0 && (
            <LinkSelect
              id="rank-by"
              label="Rank by"
              className="w-full sm:w-56"
              value={hrefFor(basePath, query)}
              options={[
                { href: hrefFor(basePath, { ...query, metric: null }), label: "Points" },
                ...metrics.map((m) => ({ href: hrefFor(basePath, { ...query, metric: m.id }), label: m.name })),
              ]}
            />
          )}
          <div role="group" className="flex items-center gap-1" aria-label="Choose period">
            <Link
              href={hrefFor(basePath, { ...query, date: shiftPeriod(period, start, -1) })}
              className={buttonVariants({ variant: "outline", size: "icon" })}
              aria-label={`Previous ${period === "daily" ? "day" : period.replace("ly", "")}`}
            >
              <ChevronLeft />
            </Link>
            <span className="min-w-36 text-center text-sm font-medium tabular-nums" aria-live="polite">
              {formatPeriod(period, start, periodEnd(period, start))}
            </span>
            {isCurrent ? (
              <span className={cn(buttonVariants({ variant: "outline", size: "icon" }), "pointer-events-none opacity-40")} aria-hidden>
                <ChevronRight />
              </span>
            ) : (
              <Link
                href={hrefFor(basePath, { ...query, date: shiftPeriod(period, start, 1) })}
                className={buttonVariants({ variant: "outline", size: "icon" })}
                aria-label={`Next ${period === "daily" ? "day" : period.replace("ly", "")}`}
              >
                <ChevronRight />
              </Link>
            )}
          </div>
        </div>
      </div>

      {noRules && !rankMetric && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          No {period} scoring rules are set up {overall ? "yet" : `for ${categoryLabel(category)} yet`}, so nobody has points for this
          period.{" "}
          {isAdmin ? (
            <Link href="/admin/goals" className="font-medium underline underline-offset-4">
              Add scoring rules
            </Link>
          ) : (
            "Rankings will appear once your administrator adds them."
          )}
        </p>
      )}

      <Card className="py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-4 text-primary" aria-hidden />
            {overall ? "Overall" : categoryLabel(category)} · {PERIOD_LABELS[period]}
          </CardTitle>
          <CardDescription>
            {rankMetric
              ? `Ranked by ${rankMetric.name} from approved entries.`
              : overall
                ? "Score = points earned as a % of the points available in each person's category, so both categories compare fairly."
                : "Points from your administrator's scoring rules, using approved entries only."}
          </CardDescription>
        </CardHeader>
        {ranked.length === 0 ? (
          <EmptyState icon={Trophy} title="No one to rank yet" description="Active employees in this category will appear here." />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16 pl-4">Rank</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead className="w-56">{rankMetric ? rankMetric.name : overall ? "Score" : "Points"}</TableHead>
                    {rankMetric && <TableHead className="text-right">Points</TableHead>}
                    <TableHead>Goals</TableHead>
                    <TableHead className="pr-4 text-right">Approved days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranked.map((row) => (
                    <TableRow key={row.employee_id} className={cn(row.employee_id === viewerId && "bg-primary/5")}>
                      <TableCell className="pl-4">
                        <RankBadge rank={row.rank} />
                      </TableCell>
                      <TableCell>
                        <PersonCell
                          row={row}
                          isViewer={row.employee_id === viewerId}
                          showCategory={overall}
                          isHallOfFame={hallOfFameSet.has(row.employee_id)}
                        />
                      </TableCell>
                      <TableCell>
                        <ScoreCell row={row} overall={overall} metric={rankMetric} />
                      </TableCell>
                      {rankMetric && <TableCell className="text-right tabular-nums">{row.points}</TableCell>}
                      <TableCell>
                        <GoalsCell row={row} />
                      </TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">{row.approved_days}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ol className="divide-y md:hidden">
              {ranked.map((row) => (
                <li key={row.employee_id} className={cn("flex items-start gap-3 p-4", row.employee_id === viewerId && "bg-primary/5")}>
                  <RankBadge rank={row.rank} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <PersonCell
                      row={row}
                      isViewer={row.employee_id === viewerId}
                      showCategory={overall}
                      isHallOfFame={hallOfFameSet.has(row.employee_id)}
                    />
                    <ScoreCell row={row} overall={overall} metric={rankMetric} />
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <GoalsCell row={row} />
                      <span>{row.approved_days} approved days</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </Card>

      {/* {!isAdmin && own && !overall && <Comparison own={own} metrics={metrics} />} */}
    </div>
  );
}

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="text-sm text-muted-foreground">—</span>;
  const medal = ["text-warning", "text-muted-foreground", "text-warning/60"][rank - 1];
  return (
    <span className="inline-flex min-w-8 items-center gap-1 font-semibold tabular-nums">
      {medal && <Medal className={cn("size-4", medal)} aria-hidden />}
      <span className="sr-only">Rank </span>
      {rank}
    </span>
  );
}

function PersonCell({
  row,
  isViewer,
  showCategory,
  isHallOfFame,
}: {
  row: LeaderboardRow;
  isViewer: boolean;
  showCategory: boolean;
  isHallOfFame?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{row.full_name}</span>
      {isHallOfFame && (
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1 text-[11px]"
          title="Hall of Fame Inductee"
        >
          <Trophy className="size-3 text-amber-500" aria-hidden />
          Hall of Fame
        </Badge>
      )}
      {isViewer && <Badge>You</Badge>}
      {showCategory && <Badge variant="outline">{categoryLabel(row.category)}</Badge>}
    </div>
  );
}

function ScoreCell({ row, overall, metric }: { row: LeaderboardRow; overall: boolean; metric?: MetricDefinition }) {
  if (metric) {
    return <span className="tabular-nums">{formatMetricValue(metricScore(row, metric.id), metric.data_type, metric.unit)}</span>;
  }
  const score = normalizedScore(row);
  const percent = score ?? 0;
  const label = overall ? (score === null ? "—" : `${score}%`) : `${row.points} / ${row.max_points} pts`;
  return (
    <div className="space-y-1">
      <span className="text-sm font-medium tabular-nums">{label}</span>
      {row.max_points > 0 && <ProgressBar percent={percent} label={`${row.full_name}: ${percent}% of available points`} />}
    </div>
  );
}

function GoalsCell({ row }: { row: LeaderboardRow }) {
  if (row.goals_set === 0) return <span className="text-sm text-muted-foreground">No goals</span>;
  const all = row.goals_achieved === row.goals_set;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm tabular-nums", all && "text-success")}>
      {all ? <CheckCircle2 className="size-4" aria-hidden /> : <Target className="size-4 text-muted-foreground" aria-hidden />}
      {row.goals_achieved}/{row.goals_set} achieved
    </span>
  );
}

/** The employee's own figures next to their category's average (no colleague's figures are shown). */
// function Comparison({ own, metrics }: { own: LeaderboardRow; metrics: MetricDefinition[] }) {
//   const shown = headlineMetrics(metrics, 6);
//   if (shown.length === 0) return null;
//   return (
//     <Card>
//       <CardHeader>
//         <CardTitle>You vs team average</CardTitle>
//         <CardDescription>
//           Your approved results for this period compared with your category&apos;s average. Averages appear once at least 3 people
//           have results, so no one&apos;s individual figures can be worked out.
//         </CardDescription>
//       </CardHeader>
//       <CardContent>
//         <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
//           {shown.map((m) => {
//             const mine = own.metric_values?.[m.id] ?? null;
//             const team = own.team_average?.[m.id] ?? null;
//             const diff = mine !== null && team !== null ? Number(mine) - Number(team) : null;
//             return (
//               <div key={m.id} className="rounded-lg border bg-muted/30 p-3">
//                 <dt className="truncate text-xs text-muted-foreground">{m.name}</dt>
//                 <dd className="mt-1 flex items-baseline justify-between gap-2">
//                   <span className="font-semibold tabular-nums">{formatMetricValue(mine, m.data_type, m.unit)}</span>
//                   {diff !== null && diff !== 0 && (
//                     <span className={cn("inline-flex items-center text-xs tabular-nums", diff > 0 ? "text-success" : "text-muted-foreground")}>
//                       {diff > 0 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
//                       <span className="sr-only">{diff > 0 ? "above" : "below"} average by </span>
//                       {formatMetricValue(Math.abs(diff), m.data_type, m.unit)}
//                     </span>
//                   )}
//                 </dd>
//                 <dd className="text-xs text-muted-foreground">Team average {formatMetricValue(team, m.data_type, m.unit)}</dd>
//               </div>
//             );
//           })}
//         </dl>
//       </CardContent>
//     </Card>
//   );
// }
