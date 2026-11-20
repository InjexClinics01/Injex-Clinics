import { Receipt } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { POINTS_KIND_LABELS, formatPoints } from "@/lib/points/schemas";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils/format";
import type { PointsTransaction } from "@/types/database";

/** Ledger rows, newest first. `names` adds the employee's name (admin views). */
export function TransactionList({
  rows,
  names,
  emptyText = "Points you earn and spend will appear here.",
}: {
  rows: PointsTransaction[];
  names?: Map<string, string>;
  emptyText?: string;
}) {
  if (rows.length === 0) return <EmptyState icon={Receipt} title="No transactions yet" description={emptyText} className="py-10" />;
  return (
    <ul className="divide-y">
      {rows.map((t) => (
        <li key={t.id} className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm break-words">{t.description}</p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Badge variant="outline">{POINTS_KIND_LABELS[t.kind]}</Badge>
              {names && <span className="font-medium text-foreground">{names.get(t.employee_id) ?? "Employee"}</span>}
              <time dateTime={t.created_at}>{formatDateTime(t.created_at)}</time>
            </p>
          </div>
          <span className={cn("shrink-0 font-semibold tabular-nums", t.amount > 0 ? "text-success" : "text-muted-foreground")}>
            {formatPoints(t.amount, true)}
          </span>
        </li>
      ))}
    </ul>
  );
}
