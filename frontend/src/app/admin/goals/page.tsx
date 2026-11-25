import type { Metadata } from "next";
import Link from "next/link";

import { MetricsConfig } from "@/components/admin/metrics-config";
import { PageHeader } from "@/components/layout/page-header";
import { requireAdmin } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { listCategories } from "@/services/employees";
import { listAllMetrics, listScoringRules } from "@/services/metrics";

export const metadata: Metadata = { title: "Goals & Scoring" };

export default async function GoalsScoringPage({ searchParams }: PageProps<"/admin/goals">) {
  await requireAdmin();
  const requested = (await searchParams).category;
  const [categories, allMetrics, allRules] = await Promise.all([listCategories(), listAllMetrics(), listScoringRules()]);
  const category = categories.find((c) => c.slug === requested) ?? categories[0];

  const metrics = allMetrics.filter((m) => m.category === category?.slug);
  const metricIds = new Set(metrics.map((m) => m.id));
  const rules = allRules.filter((r) => metricIds.has(r.metric_id));

  return (
    <>
      <PageHeader title="Goals & Scoring" description="Configure each role's daily form, goal metrics and scoring rules." />
      <nav aria-label="Category" className="mb-6 flex gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1">
        {categories.map((c) => (
          <Link
            key={c.slug}
            href={`/admin/goals?category=${c.slug}`}
            prefetch={true}
            aria-current={c.slug === category?.slug ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              c.slug === category?.slug ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {c.name}
          </Link>
        ))}
      </nav>
      {category && <MetricsConfig key={category.slug} category={category.slug} metrics={metrics} rules={rules} />}
    </>
  );
}
