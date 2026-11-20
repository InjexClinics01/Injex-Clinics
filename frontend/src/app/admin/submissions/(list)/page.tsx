import { ChevronRight, ClipboardList, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Pagination } from "@/components/dashboard/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { EntryStatusBadge } from "@/components/metrics/entry-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/session";
import { categoryLabel } from "@/lib/constants";
import { SUBMISSIONS_PAGE_SIZE, parseSubmissionFilters, type SubmissionFilters, type SubmissionTab } from "@/lib/performance/filters";
import { formatDay } from "@/lib/metrics/periods";
import { formatMetricValue, headlineMetrics } from "@/lib/metrics/values";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils/format";
import { listCategories } from "@/services/employees";
import { listAllMetrics } from "@/services/metrics";
import { countPendingSubmissions, listSubmissions, type SubmissionRow } from "@/services/review";
import type { MetricDefinition } from "@/types/database";

export const metadata: Metadata = { title: "Submissions" };

const TABS: { tab: SubmissionTab; label: string }[] = [
  { tab: "pending", label: "Pending" },
  { tab: "correction", label: "Needs correction" },
  { tab: "rejected", label: "Rejected" },
  { tab: "approved", label: "Approved" },
  { tab: "all", label: "All" },
];

function hrefWith(f: SubmissionFilters, changes: Partial<SubmissionFilters>) {
  const next = { ...f, ...changes };
  const params = new URLSearchParams();
  if (next.tab !== "pending") params.set("tab", next.tab);
  if (next.category) params.set("category", next.category);
  if (next.employee) params.set("employee", next.employee);
  if (next.q) params.set("q", next.q);
  if (next.from) params.set("from", next.from);
  if (next.to) params.set("to", next.to);
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return `/admin/submissions${query ? `?${query}` : ""}`;
}

/** Two or three key figures, e.g. "Revenue $2,000.00 · Hourly Revenue $250.00/h". */
function keyFigures(row: SubmissionRow, headlines: Map<string, MetricDefinition[]>) {
  return (headlines.get(row.category) ?? [])
    .map((m) => {
      const v = row.values.find((x) => x.metric_id === m.id);
      return v ? `${v.metric_name} ${formatMetricValue(v.value, v.metric_data_type, v.metric_unit)}` : null;
    })
    .filter(Boolean)
    .join(" · ");
}

export default async function SubmissionsPage({ searchParams }: PageProps<"/admin/submissions">) {
  await requireAdmin();
  const filters = parseSubmissionFilters(await searchParams);
  const [{ rows, total, page }, pending, categories, metrics] = await Promise.all([
    listSubmissions(filters),
    countPendingSubmissions(),
    listCategories(),
    listAllMetrics(),
  ]);
  const headlines = new Map(
    categories.map((c) => [c.slug, headlineMetrics(metrics.filter((m) => m.category === c.slug), 3)]),
  );
  const hasFilters = Boolean(filters.category || filters.employee || filters.q || filters.from || filters.to);

  return (
    <>
      <PageHeader
        title="Submissions"
        description={pending === 1 ? "1 entry is waiting for review." : `${pending} entries are waiting for review.`}
      />

      <nav aria-label="Submission status" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map(({ tab, label }) => (
          <Link
            key={tab}
            href={hrefWith(filters, { tab, page: 1 })}
            aria-current={filters.tab === tab ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: filters.tab === tab ? "secondary" : "ghost", size: "sm" }),
              "shrink-0",
              filters.tab === tab && "font-semibold",
            )}
          >
            {label}
            {tab === "pending" && pending > 0 && <Badge className="ml-1">{pending}</Badge>}
          </Link>
        ))}
      </nav>

      <form method="get" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_11rem_10rem_10rem_auto] lg:items-end">
        {filters.tab !== "pending" && <input type="hidden" name="tab" value={filters.tab} />}
        {filters.employee && <input type="hidden" name="employee" value={filters.employee} />}
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="q">Employee</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="q" name="q" type="search" defaultValue={filters.q} maxLength={80} placeholder="Search by name" className="h-9 pl-8" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <NativeSelect id="category" name="category" defaultValue={filters.category ?? ""}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={filters.from ?? ""} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={filters.to ?? ""} className="h-9" />
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit" className="h-9 flex-1 lg:flex-none">
            Apply
          </Button>
          {hasFilters && (
            <Link href={hrefWith(filters, { category: null, employee: null, q: "", from: null, to: null, page: 1 })} className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
              Clear
            </Link>
          )}
        </div>
      </form>

      {filters.notice && (
        <p role="status" className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {filters.notice}
        </p>
      )}

      {filters.employee && rows[0] && (
        <p className="mb-3 text-sm text-muted-foreground">
          Showing submissions by <span className="font-medium text-foreground">{rows[0].employee.full_name}</span>.
        </p>
      )}

      {filters.tab === "all" && !filters.employee && rows.length > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          Showing each employee&apos;s latest entry. Click any employee to review or view all their past daily submissions.
        </p>
      )}

      <Card className="py-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={filters.tab === "pending" && !hasFilters ? "All caught up" : "No submissions found"}
            description={
              filters.tab === "pending" && !hasFilters
                ? "There are no entries waiting for review."
                : "Try another status tab, or clear the filters."
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Employee</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="hidden xl:table-cell">Key figures</TableHead>
                    <TableHead className="hidden lg:table-cell">Submitted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12 pr-4">
                      <span className="sr-only">Review</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="pl-4">
                        <p className="font-medium">{row.employee.full_name || row.employee.email}</p>
                        <p className="text-xs text-muted-foreground">{categoryLabel(row.category)}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDay(row.entry_date)}</TableCell>
                      <TableCell className="hidden max-w-md truncate text-muted-foreground tabular-nums xl:table-cell">
                        {keyFigures(row, headlines) || "—"}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                        {row.submitted_at ? formatDateTime(row.submitted_at) : "—"}
                      </TableCell>
                      <TableCell>
                        <EntryStatusBadge status={row.status} finalRejection={row.final_rejection} />
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Link
                          href={`/admin/submissions/${row.id}`}
                          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                          aria-label={`Review ${row.employee.full_name}'s entry for ${formatDay(row.entry_date)}`}
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
              {rows.map((row) => (
                <li key={row.id}>
                  <Link href={`/admin/submissions/${row.id}`} className="flex items-center gap-3 p-4 hover:bg-muted/40">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{row.employee.full_name || row.employee.email}</span>
                        <EntryStatusBadge status={row.status} finalRejection={row.final_rejection} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDay(row.entry_date)} · {categoryLabel(row.category)}
                      </p>
                      <p className="truncate text-xs tabular-nums">{keyFigures(row, headlines)}</p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={SUBMISSIONS_PAGE_SIZE}
              total={total}
              hrefFor={(page) => hrefWith(filters, { page })}
            />
          </>
        )}
      </Card>
    </>
  );
}
