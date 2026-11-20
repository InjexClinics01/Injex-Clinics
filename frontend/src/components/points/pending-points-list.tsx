import { Hourglass } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PERIOD_LABELS, formatPeriod, periodEnd } from "@/lib/metrics/periods";
import { formatPoints } from "@/lib/points/schemas";
import type { PendingAward } from "@/types/database";

/** Points on their way: earned in open periods or from entries awaiting review. */
export function PendingPointsList({ awards }: { awards: PendingAward[] }) {
  if (awards.length === 0) {
    return (
      <EmptyState
        icon={Hourglass}
        title="Nothing pending"
        description="Points you are on track to earn this period will appear here."
        className="py-8"
      />
    );
  }
  const sorted = [...awards].sort((a, b) => b.period_start.localeCompare(a.period_start));
  return (
    <ul className="divide-y">
      {sorted.map((a) => (
        <li key={`${a.employee_id}-${a.award_key}`} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="text-sm">{a.description}</p>
            <p className="text-xs text-muted-foreground">
              {PERIOD_LABELS[a.period]} · {formatPeriod(a.period, a.period_start, periodEnd(a.period, a.period_start))}
            </p>
          </div>
          <span className="shrink-0 font-medium text-muted-foreground tabular-nums">{formatPoints(a.points, true)}</span>
        </li>
      ))}
    </ul>
  );
}
