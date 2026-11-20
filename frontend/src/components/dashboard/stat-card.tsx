import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  muted,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  hint?: string;
  /** Placeholder metric that has no data yet. */
  muted?: boolean;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
          <p className={cn("text-2xl font-semibold tracking-tight tabular-nums", muted && "text-muted-foreground/60")}>{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div
          className={cn(
            "hidden size-9 shrink-0 place-items-center rounded-lg sm:grid",
            muted ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
          )}
          aria-hidden
        >
          <Icon className="size-4.5" />
        </div>
      </CardContent>
    </Card>
  );
}
