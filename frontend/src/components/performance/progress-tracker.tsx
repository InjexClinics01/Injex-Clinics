import { ChartLine, Minus, Target, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";

import { PerformanceLineChart } from "@/components/charts/performance-line-chart";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LinkSelect } from "@/components/forms/link-select";
import { ProgressBar } from "@/components/metrics/progress-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PERIOD_LABELS, formatBucket, formatPeriod, periodEnd } from "@/lib/metrics/periods";
import { formatMetricValue, headlineMetrics } from "@/lib/metrics/values";
import { percentChange } from "@/lib/performance/ranking";
import { cn } from "@/lib/utils";
import type { GoalPeriod, GoalProgress, MetricDefinition, MetricSeriesRow } from "@/types/database";

/** How many periods each view shows. */
export const PROGRESS_BUCKETS: Record<GoalPeriod, number> = { daily: 14, weekly: 12, monthly: 12 };

const CURRENT_LABEL: Record<GoalPeriod, [string, string]> = {
  daily: ["Today", "yesterday"],
  weekly: ["This week", "last week"],
  monthly: ["This month", "last month"],
};

export type ProgressTrackerProps = {
  basePath: string;
  view: GoalPeriod;
  /** Period start dates, oldest first; the last one contains today. */
  buckets: string[];
  /** Active metrics of the employee's category. */
  metrics: MetricDefinition[];
  selected: MetricDefinition | null;
  series: MetricSeriesRow[];
  goals: GoalProgress[];
};

function hrefFor(basePath: string, view: GoalPeriod, metric: string | null) {
  const params = new URLSearchParams({ period: view });
  if (metric) params.set("metric", metric);
  return `${basePath}?${params}`;
}

export function ProgressTracker({ basePath, view, buckets, metrics, selected, series, goals }: ProgressTrackerProps) {
  const value = (metricId: string, bucket: string | undefined) =>
    series.find((r) => r.metric_id === metricId && r.bucket === bucket) ?? null;
  const current = buckets[buckets.length - 1];
  const previous = buckets[buckets.length - 2];
  const metricById = new Map(metrics.map((m) => [m.id, m]));
  const tiles = headlineMetrics(metrics, 4);

  if (metrics.length === 0) {
    return (
      <Card>
        <EmptyState icon={ChartLine} title="Nothing to track yet" description="The daily form for this category hasn't been set up." />
      </Card>
    );
  }

  const points = buckets.map((b) => ({ label: formatBucket(view, b), value: selected ? (value(selected.id, b)?.value ?? null) : null }));
  const hasData = points.some((p) => p.value !== null);
  const goal = goals.find((g) => g.metric_id === selected?.id && g.period === view && g.period_start === current);
  const target = goal?.target_value ?? (view === "daily" ? selected?.default_target : null) ?? null;
  const change = selected ? percentChange(value(selected.id, current)?.value, value(selected.id, previous)?.value) : null;
  const [currentLabel, previousLabel] = CURRENT_LABEL[view];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <nav aria-label="Period" className="flex w-fit gap-1 rounded-lg bg-muted p-1">
          {(["daily", "weekly", "monthly"] as const).map((p) => (
            <Link
              key={p}
              href={hrefFor(basePath, p, selected?.id ?? null)}
              prefetch={true}
              aria-current={p === view ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                p === view && "bg-background text-foreground shadow-sm",
              )}
            >
              {PERIOD_LABELS[p]}
            </Link>
          ))}
        </nav>
        <LinkSelect
          id="metric"
          label="Metric"
          className="w-full sm:w-64"
          value={hrefFor(basePath, view, selected?.id ?? null)}
          options={metrics.map((m) => ({ href: hrefFor(basePath, view, m.id), label: m.name }))}
        />
      </div>

      <section aria-label={`${currentLabel} compared with ${previousLabel}`} className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {tiles.map((m) => {
          const now = value(m.id, current)?.value ?? null;
          const delta = percentChange(now, value(m.id, previous)?.value);
          return (
            <Card key={m.id} size="sm">
              <CardContent className="space-y-1">
                <p className="truncate text-xs text-muted-foreground sm:text-sm">
                  {m.name} · {currentLabel.toLowerCase()}
                </p>
                <p className="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{formatMetricValue(now, m.data_type, m.unit)}</p>
                <Trend change={delta} versus={previousLabel} />
              </CardContent>
            </Card>
          );
        })}
      </section>

      <div className="grid gap-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{selected?.name ?? "Performance"}</CardTitle>
            <CardDescription>
              {PERIOD_LABELS[view]} · last {buckets.length} {view === "daily" ? "days" : view === "weekly" ? "weeks" : "months"} · approved
              entries only
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected && hasData ? (
              <>
                <PerformanceLineChart
                  data={points}
                  dataType={selected.data_type}
                  unit={selected.unit}
                  target={target}
                  summary={`${selected.name}, ${PERIOD_LABELS[view].toLowerCase()}: ${points
                    .filter((p) => p.value !== null)
                    .map((p) => `${p.label} ${formatMetricValue(p.value, selected.data_type, selected.unit)}`)
                    .join(", ")}`}
                />
                <Trend change={change} versus={previousLabel} />
                <details className="group text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show as table</summary>
                  <Table className="mt-2">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">{selected.name}</TableHead>
                        <TableHead className="text-right">Approved days</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...buckets].reverse().map((b) => {
                        const row = value(selected.id, b);
                        return (
                          <TableRow key={b}>
                            <TableCell>{formatPeriod(view, b, periodEnd(view, b))}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatMetricValue(row?.value, selected.data_type, selected.unit)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{row?.entries_counted ?? 0}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </details>
              </>
            ) : (
              <EmptyState
                icon={ChartLine}
                title="No approved data yet"
                description="Results appear here once daily entries for this period have been approved."
                className="py-10"
              />
            )}
          </CardContent>
        </Card>

        {/* <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Goals vs actual</CardTitle>
            <CardDescription>Verified = approved entries. Submitted includes entries awaiting review.</CardDescription>
          </CardHeader>
          <CardContent>
            {goals.length === 0 ? (
              <EmptyState icon={Target} title="No active goals" description="Current goals and their progress will appear here." className="py-8" />
            ) : (
              <ul className="space-y-5">
                {goals.map((g) => {
                  const m = metricById.get(g.metric_id);
                  const fmt = (v: number | null) => formatMetricValue(v, m?.data_type ?? "decimal", m?.unit ?? null);
                  return (
                    <li key={g.goal_id} className="space-y-1.5">
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="truncate font-medium">
                          {m?.name ?? "Metric"}{" "}
                          <span className="font-normal text-muted-foreground">
                            · {PERIOD_LABELS[g.period]} · {formatPeriod(g.period, g.period_start, g.period_end)}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums">{g.verified_percent}%</span>
                      </div>
                      <ProgressBar percent={g.verified_percent} label={`${m?.name} goal, verified progress`} />
                      <p className="text-xs text-muted-foreground tabular-nums">
                        Verified {fmt(g.verified_value ?? 0)} of {fmt(g.target_value)}
                        {g.current_value !== g.verified_value && ` · submitted ${fmt(g.current_value ?? 0)} (${g.percent_complete}%)`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card> */}
      </div>
    </div>
  );
}

function Trend({ change, versus }: { change: number | null; versus: string }) {
  if (change === null) return <p className="text-xs text-muted-foreground">No comparison with {versus}</p>;
  const Icon = change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus;
  return (
    <p className={cn("flex items-center gap-1 text-xs", change > 0 ? "text-success" : "text-muted-foreground")}>
      <Icon className="size-3.5" aria-hidden />
      <span className="tabular-nums">
        {change > 0 ? "+" : ""}
        {change}%
      </span>
      <span className="text-muted-foreground">vs {versus}</span>
    </p>
  );
}
