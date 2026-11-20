import { Badge } from "@/components/ui/badge";
import { REDEMPTION_STATUS_LABELS } from "@/lib/points/schemas";
import { cn } from "@/lib/utils";
import type { RedemptionStatus } from "@/types/database";

const STYLES: Record<RedemptionStatus, string> = {
  pending: "border-warning/50 text-warning",
  approved: "border-primary/40 text-primary",
  fulfilled: "border-success/40 text-success",
  rejected: "border-destructive/40 text-destructive",
  cancelled: "text-muted-foreground",
};

export function RedemptionStatusBadge({ status }: { status: RedemptionStatus }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", STYLES[status])}>
      {REDEMPTION_STATUS_LABELS[status]}
    </Badge>
  );
}
