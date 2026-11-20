import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PROGRESS_BUCKETS, ProgressTracker } from "@/components/performance/progress-tracker";
import { requireEmployee } from "@/lib/auth/session";
import { parseMetric, parsePeriod } from "@/lib/performance/filters";
import { getProgressData } from "@/services/performance";

export const metadata: Metadata = { title: "My Progress" };

export default async function EmployeeProgressPage({ searchParams }: PageProps<"/employee/progress">) {
  const profile = await requireEmployee();
  const params = await searchParams;
  const view = parsePeriod(params, "daily");
  const data = await getProgressData(profile, view, parseMetric(params), PROGRESS_BUCKETS[view]);

  return (
    <>
      <PageHeader title="My Progress" description="Your verified results over time, your trends and your goals." />
      <ProgressTracker basePath="/employee/progress" {...data} />
    </>
  );
}
