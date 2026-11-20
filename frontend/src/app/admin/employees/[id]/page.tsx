import { ArrowLeft, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { PROGRESS_BUCKETS, ProgressTracker } from "@/components/performance/progress-tracker";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/session";
import { categoryLabel } from "@/lib/constants";
import { isUuid, parseMetric, parsePeriod } from "@/lib/performance/filters";
import { getProfile } from "@/services/employees";
import { getProgressData } from "@/services/performance";

export const metadata: Metadata = { title: "Employee performance" };

export default async function EmployeePerformancePage({ params, searchParams }: PageProps<"/admin/employees/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const employee = await getProfile(id);
  if (!employee || employee.role !== "employee") notFound();

  const query = await searchParams;
  const view = parsePeriod(query, "daily");
  const data = await getProgressData(employee, view, parseMetric(query), PROGRESS_BUCKETS[view]);

  return (
    <>
      <Link href="/admin/employees" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2 mb-3" })}>
        <ArrowLeft aria-hidden /> Employees
      </Link>
      <PageHeader
        title={employee.full_name || employee.email}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{categoryLabel(employee.employee_category)}</Badge>
            {!employee.is_active && <Badge variant="outline">Inactive</Badge>}
            Verified performance and goals
          </span>
        }
        actions={
          <Link href={`/admin/submissions?tab=all&employee=${employee.id}`} className={buttonVariants({ variant: "outline" })}>
            <ListChecks aria-hidden /> Submissions
          </Link>
        }
      />
      <ProgressTracker basePath={`/admin/employees/${employee.id}`} {...data} />
    </>
  );
}
