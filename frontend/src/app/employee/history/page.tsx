import { ChevronRight, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Pagination } from "@/components/dashboard/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { EntryStatusBadge } from "@/components/metrics/entry-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireEmployee } from "@/lib/auth/session";
import { formatDay } from "@/lib/metrics/periods";
import { formatMetricValue, headlineMetrics } from "@/lib/metrics/values";
import { parsePage } from "@/lib/utils/fetch-page";
import { HISTORY_PAGE_SIZE, listEntriesPage, listMetrics, type EntryWithValues } from "@/services/metrics";
import type { MetricDefinition } from "@/types/database";

export const metadata: Metadata = { title: "My History" };

function display(entry: EntryWithValues, metric: MetricDefinition) {
  const v = entry.values.find((x) => x.metric_id === metric.id);
  return v ? formatMetricValue(v.value, v.metric_data_type, v.metric_unit) : "—";
}

/** Admin feedback is shown once the entry has been reviewed (not while it waits for review again). */
function feedback(entry: EntryWithValues) {
  return entry.status === "approved" || entry.status === "rejected" ? (entry.review_note ?? "") : "";
}

export default async function HistoryPage({ searchParams }: PageProps<"/employee/history">) {
  const profile = await requireEmployee();
  const requestedPage = parsePage((await searchParams).page);
  const [{ rows: entries, total, page }, metrics] = await Promise.all([
    listEntriesPage(profile.id, requestedPage),
    profile.employee_category ? listMetrics(profile.employee_category) : Promise.resolve([]),
  ]);
  const columns = headlineMetrics(metrics);

  return (
    <>
      <PageHeader title="My History" description="Your daily entries, newest first." />
      <Card className="py-0">
        {entries.length === 0 ? (
          <EmptyState
            icon={History}
            title="No entries yet"
            description="Your submitted and draft daily entries will appear here."
            action={
              <Link href="/employee/daily-entry" className={buttonVariants()}>
                Add today&apos;s entry
              </Link>
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden xl:table-cell">Feedback</TableHead>
                    {columns.map((m) => (
                      <TableHead key={m.id} className="hidden text-right lg:table-cell">
                        {m.name}
                      </TableHead>
                    ))}
                    <TableHead className="w-12 pr-4">
                      <span className="sr-only">Open</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="pl-4 font-medium">{formatDay(e.entry_date)}</TableCell>
                      <TableCell>
                        <EntryStatusBadge status={e.status} finalRejection={e.final_rejection} />
                      </TableCell>
                      <TableCell className="hidden max-w-56 truncate text-muted-foreground xl:table-cell" title={feedback(e)}>
                        {feedback(e) || "—"}
                      </TableCell>
                      {columns.map((m) => (
                        <TableCell key={m.id} className="hidden text-right tabular-nums lg:table-cell">
                          {display(e, m)}
                        </TableCell>
                      ))}
                      <TableCell className="pr-4 text-right">
                        <Link
                          href={`/employee/daily-entry?date=${e.entry_date}`}
                          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                          aria-label={`Open entry for ${formatDay(e.entry_date)}`}
                        >
                          <ChevronRight />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y md:hidden">
              {entries.map((e) => (
                <li key={e.id}>
                  <Link href={`/employee/daily-entry?date=${e.entry_date}`} className="flex items-center gap-3 p-4 hover:bg-muted/40">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{formatDay(e.entry_date)}</span>
                        <EntryStatusBadge status={e.status} finalRejection={e.final_rejection} />
                      </div>
                      {feedback(e) && <p className="line-clamp-2 text-xs text-muted-foreground">Feedback: {feedback(e)}</p>}
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        {columns.map((m) => (
                          <div key={m.id} className="flex justify-between gap-2">
                            <dt className="truncate text-muted-foreground">{m.name}</dt>
                            <dd className="tabular-nums">{display(e, m)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={HISTORY_PAGE_SIZE}
              total={total}
              hrefFor={(p) => (p > 1 ? `/employee/history?page=${p}` : "/employee/history")}
            />
          </>
        )}
      </Card>
    </>
  );
}
