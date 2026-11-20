import { BarChart3, ClipboardCheck, Download, HeartPulse, Sparkles, Target, Trophy, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SubmissionsBarChart } from "@/components/charts/submissions-bar-chart";
import { EmptyState } from "@/components/dashboard/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/session";
import { categoryLabel } from "@/lib/constants";
import { formatDay } from "@/lib/metrics/periods";
import { formatMetricValue, headlineMetrics } from "@/lib/metrics/values";
import { REPORT_MAX_DAYS, parseReportFilters, type ReportFilters } from "@/lib/performance/filters";
import { leadMetric, rate, submissionBuckets, teamStats, topPerformers, type EmployeeSummary } from "@/lib/reports/summary";
import { computeStaffStats } from "@/services/employees";
import { appToday } from "@/services/metrics";
import { getReportSummaries, getSubmissionStats } from "@/services/performance";
import { countPendingSubmissions } from "@/services/review";
import type { MetricDefinition } from "@/types/database";

export const metadata: Metadata = { title: "Reports" };

function query(f: ReportFilters, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ from: f.from, to: f.to, ...extra });
  if (f.category) params.set("category", f.category);
  if (f.employee) params.set("employee", f.employee);
  return params.toString();
}

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  await requireAdmin();
  const today = appToday();
  const f = parseReportFilters(await searchParams, today);
  const [{ profiles, categories, shownCategories, metrics, summaries }, pending, stats] = await Promise.all([
    getReportSummaries(f),
    countPendingSubmissions(),
    getSubmissionStats(f.from, f.to, { category: f.category, employee: f.employee }),
  ]);
  const staff = computeStaffStats(profiles);

  const submitted = stats.reduce((n, s) => n + s.submitted, 0);
  const approved = stats.reduce((n, s) => n + s.approved, 0);
  const goalsCompleted = summaries.reduce((n, s) => n + s.goalsCompleted, 0);
  const goalsAchieved = summaries.reduce((n, s) => n + s.goalsAchieved, 0);
  const goalRate = rate(goalsAchieved, goalsCompleted);
  const { weekly, buckets: bars } = submissionBuckets(stats, f.from, f.to);
  const hasFilters = Boolean(f.category || f.employee);

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Verified performance (approved entries) from ${formatDay(f.from)} to ${formatDay(f.to)}.`}
        actions={
          <>
            <a href={`/admin/reports/export?${query(f, { type: "summary" })}`} className={buttonVariants({ variant: "outline" })}>
              <Download aria-hidden /> Summary CSV
            </a>
            <a href={`/admin/reports/export?${query(f, { type: "entries" })}`} className={buttonVariants({ variant: "outline" })}>
              <Download aria-hidden /> Entries CSV
            </a>
          </>
        }
      />

      <section aria-label="Team summary" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Active employees" value={staff.active} icon={Users} hint={`${staff.total} total`} />
        <StatCard label="Nurses" value={staff.byCategory.nurse ?? 0} icon={HeartPulse} hint="Active" />
        <StatCard label="Beauty Therapists" value={staff.byCategory.beauty_therapist ?? 0} icon={Sparkles} hint="Active" />
        <Link href="/admin/submissions" className="rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <StatCard label="Pending approvals" value={pending} icon={ClipboardCheck} hint="Open the review queue" muted={pending === 0} />
        </Link>
      </section>

      <form method="get" className="mt-6 grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_1fr_1fr_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={f.from} max={today} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={f.to} max={today} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <NativeSelect id="category" name="category" defaultValue={f.category ?? ""}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="employee">Employee</Label>
          <NativeSelect id="employee" name="employee" defaultValue={f.employee ?? ""}>
            <option value="">All employees</option>
            {profiles
              .filter((p) => p.role === "employee" && p.employee_category)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email} · {categoryLabel(p.employee_category)}
                </option>
              ))}
          </NativeSelect>
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit" className="h-9 flex-1 lg:flex-none">
            Apply
          </Button>
          {hasFilters && (
            <Link href={`/admin/reports?${query({ ...f, category: null, employee: null })}`} className={buttonVariants({ variant: "outline", className: "h-9" })}>
              Clear
            </Link>
          )}
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">Ranges up to {REPORT_MAX_DAYS} days.</p>
      </form>

      {f.notice && (
        <p role="status" className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {f.notice}
        </p>
      )}

      <section aria-label="Results for the selected range" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Submissions" value={submitted} icon={ClipboardCheck} hint={`${approved} approved`} muted={submitted === 0} />
        <StatCard
          label="Approval rate"
          value={rate(approved, submitted) === null ? "—" : `${rate(approved, submitted)}%`}
          icon={BarChart3}
          hint="Approved of submitted"
          muted={submitted === 0}
        />
        <StatCard
          label="Goal achievement"
          value={goalRate === null ? "—" : `${goalRate}%`}
          icon={Target}
          hint={`${goalsAchieved} of ${goalsCompleted} completed goals`}
          muted={goalsCompleted === 0}
        />
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Daily submissions</CardTitle>
          <CardDescription>
            {weekly ? "Per week" : "Per day"} by current status. Drafts are not included.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {submitted === 0 ? (
            <EmptyState icon={BarChart3} title="No submissions in this range" className="py-8" />
          ) : (
            <>
              <SubmissionsBarChart
                data={bars}
                summary={`${submitted} submissions: ${approved} approved, ${stats.reduce((n, s) => n + s.pending, 0)} pending, ${stats.reduce((n, s) => n + s.rejected, 0)} sent back or rejected.`}
              />
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show as table</summary>
                <div className="mt-2 max-h-80 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Day</TableHead>
                        <TableHead className="text-right">Submitted</TableHead>
                        <TableHead className="text-right">Approved</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right">Sent back / rejected</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...stats].reverse().map((s) => (
                        <TableRow key={s.day}>
                          <TableCell>{formatDay(s.day)}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.submitted}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.approved}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.pending}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.rejected}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            </>
          )}
        </CardContent>
      </Card>

      {shownCategories.length === 0 ? (
        <Card className="mt-6">
          <EmptyState icon={Users} title="No employees match these filters" />
        </Card>
      ) : (
        shownCategories.map((c) => {
          const categoryMetrics = metrics.filter((m) => m.category === c.slug);
          const people = summaries.filter((s) => s.employee.employee_category === c.slug);
          return <CategorySection key={c.slug} name={c.name} metrics={categoryMetrics} people={people} />;
        })
      )}
    </>
  );
}

function CategorySection({
  name,
  metrics,
  people,
}: {
  name: string;
  metrics: MetricDefinition[];
  people: EmployeeSummary[];
}) {
  const columns = headlineMetrics(metrics, 4);
  const lead = leadMetric(metrics);
  const top = lead ? topPerformers(people, lead.id) : [];
  const completed = people.reduce((n, s) => n + s.goalsCompleted, 0);
  const achieved = people.reduce((n, s) => n + s.goalsAchieved, 0);

  return (
    <section aria-label={name} className="mt-8 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{name}</h2>
        <p className="text-sm text-muted-foreground">
          {people.length} {people.length === 1 ? "employee" : "employees"} · goals {achieved}/{completed} achieved
          {rate(achieved, completed) !== null && ` (${rate(achieved, completed)}%)`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="size-4 text-primary" aria-hidden /> Top performers
            </CardTitle>
            <CardDescription>{lead ? `By ${lead.name}` : "No metrics configured"}</CardDescription>
          </CardHeader>
          <CardContent>
            {!lead || top.length === 0 ? (
              <p className="text-sm text-muted-foreground">No approved results in this range.</p>
            ) : (
              <ol className="space-y-2">
                {top.map((s, i) => (
                  <li key={s.employee.id} className="flex items-center justify-between gap-3 text-sm">
                    <Link href={`/admin/employees/${s.employee.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                      <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{i + 1}.</span>
                      <span className="truncate font-medium">{s.employee.full_name || s.employee.email}</span>
                    </Link>
                    <span className="shrink-0 tabular-nums">{formatMetricValue(s.values[lead.id], lead.data_type, lead.unit)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Team performance</CardTitle>
            <CardDescription>Average per employee with approved results, and the best result.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Average</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Best</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics
                  .filter((m) => m.is_active)
                  .map((m) => {
                    const t = teamStats(people, m.id);
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMetricValue(t.average, m.data_type, m.unit)}</TableCell>
                        <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                          {t.best ? `${formatMetricValue(t.best.values[m.id], m.data_type, m.unit)} · ${t.best.employee.full_name}` : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Employee</TableHead>
                <TableHead className="text-right">Approved days</TableHead>
                <TableHead className="text-right">Goals</TableHead>
                {columns.map((m) => (
                  <TableHead key={m.id} className="hidden text-right md:table-cell">
                    {m.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((s) => (
                <TableRow key={s.employee.id}>
                  <TableCell className="pl-4">
                    <Link
                      href={`/admin/employees/${s.employee.id}`}
                      className="font-medium hover:underline"
                    >
                      {s.employee.full_name || s.employee.email}
                    </Link>
                    {!s.employee.is_active && (
                      <Badge variant="outline" className="ml-2">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.approvedDays}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.goalsCompleted ? `${s.goalsAchieved}/${s.goalsCompleted}` : "—"}
                  </TableCell>
                  {columns.map((m) => (
                    <TableCell key={m.id} className="hidden text-right tabular-nums md:table-cell">
                      {formatMetricValue(s.values[m.id], m.data_type, m.unit)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </section>
  );
}
