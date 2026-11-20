import type { Metadata } from "next";
import Link from "next/link";

import { ActivityList } from "@/components/dashboard/activity-list";
import { Pagination } from "@/components/dashboard/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { parsePage } from "@/lib/utils/fetch-page";
import { AUDIT_FILTERS, AUDIT_PAGE_SIZE, listAuditLog, listProfiles, type AuditFilter } from "@/services/employees";
import { listAllMetrics } from "@/services/metrics";

export const metadata: Metadata = { title: "Audit log" };

const LABELS: Record<AuditFilter, string> = {
  all: "Everything",
  entries: "Submissions & corrections",
  configuration: "Metrics, scoring & settings",
  points: "Points & rewards",
  accounts: "Accounts",
};

const hrefFor = (filter: AuditFilter, page = 1) =>
  `/admin/audit?${new URLSearchParams({ ...(filter !== "all" && { type: filter }), ...(page > 1 && { page: String(page) }) })}`;

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireAdmin();
  const params = await searchParams;
  const filter = (Object.keys(AUDIT_FILTERS) as AuditFilter[]).find((k) => k === params.type) ?? "all";
  const [{ rows, total, page }, profiles, metrics] = await Promise.all([
    listAuditLog(filter, parsePage(params.page)),
    listProfiles(),
    listAllMetrics(),
  ]);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every approval, rejection, correction, points adjustment, redemption and configuration change, with who made it and when. Entries cannot be edited or deleted."
      />
      <nav aria-label="Filter the audit log" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
        {(Object.keys(LABELS) as AuditFilter[]).map((key) => (
          <Link
            key={key}
            href={hrefFor(key)}
            aria-current={key === filter ? "page" : undefined}
            className={cn(buttonVariants({ variant: key === filter ? "secondary" : "ghost", size: "sm" }), "shrink-0")}
          >
            {LABELS[key]}
          </Link>
        ))}
      </nav>
      <Card className="pb-0">
        <CardContent>
          <ActivityList
            items={rows}
            profilesById={new Map(profiles.map((p) => [p.id, p]))}
            metricsById={new Map(metrics.map((m) => [m.id, m]))}
            emptyText="Nothing has been recorded for this filter yet."
          />
        </CardContent>
        <Pagination page={page} pageSize={AUDIT_PAGE_SIZE} total={total} hrefFor={(p) => hrefFor(filter, p)} />
      </Card>
    </>
  );
}
