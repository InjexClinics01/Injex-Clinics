import { ArrowRight, BarChart3, ClipboardCheck, Coins, Gift, HeartPulse, Sparkles, Trophy, UserX, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActivityList } from "@/components/dashboard/activity-list";
import { Pagination } from "@/components/dashboard/pagination";
import { StatCard } from "@/components/dashboard/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { firstName } from "@/lib/utils/format";
import { parsePage } from "@/lib/utils/fetch-page";
import { AUDIT_FILTERS, AUDIT_PAGE_SIZE, computeStaffStats, listAuditLog, listProfiles, type AuditFilter } from "@/services/employees";
import { listAllMetrics } from "@/services/metrics";
import { RedemptionStatusBadge } from "@/components/points/redemption-status-badge";
import { formatPoints } from "@/lib/points/schemas";
import { countRedemptions, listBalances, listRedemptions, syncPointsAfterResponse } from "@/services/points";
import { countPendingSubmissions } from "@/services/review";

export const metadata: Metadata = { title: "Admin overview" };

const OVERVIEW_AUDIT_PAGE_SIZE = 20;

const AUDIT_LABELS: Record<AuditFilter, string> = {
  all: "Everything",
  entries: "Submissions & corrections",
  configuration: "Metrics, scoring & settings",
  points: "Points & rewards",
  accounts: "Accounts",
};

const auditHrefFor = (filter: AuditFilter, page = 1) =>
  `/admin?${new URLSearchParams({ ...(filter !== "all" && { type: filter }), ...(page > 1 && { page: String(page) }) })}`;

export default async function AdminOverviewPage({ searchParams }: PageProps<"/admin">) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const auditFilter = (Object.keys(AUDIT_FILTERS) as AuditFilter[]).find((k) => k === params.type) ?? "all";
  const auditPage = parsePage(params.page);

  await syncPointsAfterResponse();
  const [
    profiles,
    { rows: auditRows, total: auditTotal, page: currentAuditPage },
    pending,
    metrics,
    balances,
    { rows: redemptions },
    pendingRedemptions,
  ] = await Promise.all([
    listProfiles(),
    listAuditLog(auditFilter, auditPage, OVERVIEW_AUDIT_PAGE_SIZE),
    countPendingSubmissions(),
    listAllMetrics(),
    listBalances(),
    listRedemptions({ pageSize: 5 }),
    countRedemptions("pending"),
  ]);
  const totalAwarded = balances.reduce((n, b) => n + b.lifetime_earned, 0);
  const topEarners = [...balances].filter((b) => b.lifetime_earned > 0).sort((a, b) => b.lifetime_earned - a.lifetime_earned).slice(0, 5);
  const stats = computeStaffStats(profiles);
  const profilesById = new Map(profiles.map((p) => [p.id, p]));
  const metricsById = new Map(metrics.map((m) => [m.id, m]));

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName(admin.full_name, "Admin")}`}
        description="Here's an overview of your team."
        actions={
          <>
            <Link href="/admin/submissions" className={buttonVariants()}>
              <ClipboardCheck /> Review submissions
              {pending > 0 && <Badge variant="secondary">{pending}</Badge>}
            </Link>
            <Link href="/admin/employees" className={buttonVariants({ variant: "outline" })}>
              <Users /> Manage employees
            </Link>
          </>
        }
      />

      <section aria-label="Team summary" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Active employees" value={stats.active} icon={Users} hint={`${stats.total} total`} />
        <StatCard label="Nurses" value={stats.byCategory.nurse ?? 0} icon={HeartPulse} hint="Active" />
        <StatCard label="Beauty Therapists" value={stats.byCategory.beauty_therapist ?? 0} icon={Sparkles} hint="Active" />
        <StatCard
          label="Needs attention"
          value={stats.unassigned + stats.inactive}
          icon={UserX}
          hint={`${stats.unassigned} unassigned · ${stats.inactive} inactive`}
          muted={stats.unassigned + stats.inactive === 0}
        />
      </section>

      <div className="mt-6">
        <Card className="flex flex-col pb-0 w-full">
          <CardHeader>
            <CardTitle>Audit log</CardTitle>
            <CardDescription>Every approval, rejection, correction, points adjustment and configuration change.</CardDescription>
          </CardHeader>
          <div className="px-6 pb-2">
            <nav aria-label="Filter the audit log" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
              {(Object.keys(AUDIT_LABELS) as AuditFilter[]).map((key) => (
                <Link
                  key={key}
                  href={auditHrefFor(key)}
                  aria-current={key === auditFilter ? "page" : undefined}
                  className={cn(buttonVariants({ variant: key === auditFilter ? "secondary" : "ghost", size: "sm" }), "shrink-0")}
                >
                  {AUDIT_LABELS[key]}
                </Link>
              ))}
            </nav>
          </div>
          <CardContent className="flex-1">
            <ActivityList
              items={auditRows}
              profilesById={profilesById}
              metricsById={metricsById}
              emptyText="Nothing has been recorded for this filter yet."
            />
          </CardContent>
          <Pagination
            page={currentAuditPage}
            pageSize={OVERVIEW_AUDIT_PAGE_SIZE}
            total={auditTotal}
            hrefFor={(p) => auditHrefFor(auditFilter, p)}
          />
        </Card>

        {/* <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Review queue</CardTitle>
              <CardDescription>Only approved entries count towards the leaderboard and reports.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-3xl font-semibold tabular-nums">
                {pending} <span className="text-sm font-normal text-muted-foreground">waiting for review</span>
              </p>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                <Link href="/admin/submissions" className={buttonVariants({ variant: "outline" })}>
                  <ClipboardCheck /> Review
                </Link>
                <Link href="/admin/leaderboard" className={buttonVariants({ variant: "outline" })}>
                  <Trophy /> Leaderboard
                </Link>
                <Link href="/admin/reports" className={buttonVariants({ variant: "outline" })}>
                  <BarChart3 /> Reports
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Coins className="size-4 text-primary" aria-hidden /> Points & rewards
                </CardTitle>
                <CardDescription>{formatPoints(totalAwarded)} points awarded in total</CardDescription>
              </div>
              <Link href="/admin/rewards" className={buttonVariants({ variant: pendingRedemptions > 0 ? "default" : "ghost", size: "sm" })}>
                <Gift /> Redemptions
                {pendingRedemptions > 0 && <Badge variant="secondary">{pendingRedemptions}</Badge>}
              </Link>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Top earners (lifetime)</p>
                {topEarners.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No points credited yet.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {topEarners.map((b, i) => (
                      <li key={b.employee_id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate">
                          <span className="mr-2 text-muted-foreground tabular-nums">{i + 1}.</span>
                          {b.full_name}
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">{formatPoints(b.lifetime_earned)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Recent reward activity</p>
                {redemptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No redemptions yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {redemptions.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">
                          {r.employee?.full_name ?? "Employee"} · {r.reward_name}
                        </span>
                        <RedemptionStatusBadge status={r.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Link href="/admin/points" className={cn(buttonVariants({ variant: "link" }), "px-0")}>
                Balances and ledger <ArrowRight />
              </Link>
            </CardContent>
          </Card>
        </div> */}
      </div>
    </>
  );
}
