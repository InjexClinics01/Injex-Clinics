import { ArrowLeft, ChartLine, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityList } from "@/components/dashboard/activity-list";
import { PageHeader } from "@/components/layout/page-header";
import { EntryStatusBadge } from "@/components/metrics/entry-status-badge";
import { EntryValuesEditor } from "@/components/review/entry-values-editor";
import { ReviewPanel } from "@/components/review/review-panel";
import { SubmissionDateSelector } from "@/components/review/submission-date-selector";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { categoryLabel } from "@/lib/constants";
import { isUuid } from "@/lib/performance/filters";
import { formatDay } from "@/lib/metrics/periods";
import { formatDateTime } from "@/lib/utils/format";
import { listProfiles } from "@/services/employees";
import { listAllMetrics } from "@/services/metrics";
import { getEmployeeSubmissionDates, getSubmission } from "@/services/review";

export const metadata: Metadata = { title: "Review submission" };

export default async function SubmissionPage({ params }: PageProps<"/admin/submissions/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const entry = await getSubmission(id);
  if (!entry) notFound();

  const [metrics, profiles, submissionDates] = await Promise.all([
    listAllMetrics(),
    listProfiles(),
    getEmployeeSubmissionDates(entry.employee_id),
  ]);

  const recorded = new Set(entry.values.map((v) => v.metric_id));
  const inputs = metrics.filter((m) => m.category === entry.category && m.kind === "input" && (m.is_active || recorded.has(m.id)));
  const name = entry.employee.full_name || entry.employee.email;

  return (
    <>
      <Link href="/admin/submissions" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2 mb-3" })}>
        <ArrowLeft aria-hidden /> Submissions
      </Link>
      <PageHeader
        title={name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{categoryLabel(entry.category)}</Badge>
            {formatDay(entry.entry_date)}
            <EntryStatusBadge status={entry.status} finalRejection={entry.final_rejection} />
          </span>
        }
        actions={
          <>
            <Link href={`/admin/submissions?tab=all&employee=${entry.employee_id}`} className={buttonVariants({ variant: "outline" })}>
              <ListChecks aria-hidden /> All their submissions
            </Link>
            <Link href={`/admin/employees/${entry.employee_id}`} className={buttonVariants({ variant: "outline" })}>
              <ChartLine aria-hidden /> Performance
            </Link>
          </>
        }
      />

      {submissionDates.length > 1 && (
        <div className="-mt-3 mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-2.5">
          <SubmissionDateSelector currentEntryId={entry.id} dates={submissionDates} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <EntryValuesEditor entryId={entry.id} status={entry.status} inputs={inputs} values={entry.values} />
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
              <CardDescription>
                Submitted {entry.submitted_at ? formatDateTime(entry.submitted_at) : "—"}. Every status change and correction is recorded.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityList
                items={entry.history}
                profilesById={new Map(profiles.map((p) => [p.id, p]))}
                inEntry
                emptyText="Status changes and corrections will appear here."
              />
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <ReviewPanel
            entryId={entry.id}
            status={entry.status}
            finalRejection={entry.final_rejection}
            reviewNote={entry.review_note}
            reviewerName={entry.reviewer?.full_name ?? null}
            reviewedAt={entry.reviewed_at}
          />
        </div>
      </div>
    </>
  );
}
