import { Badge } from "@/components/ui/badge";
import { entryStatusLabel } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { EntryStatus } from "@/types/database";

const STYLES: Record<EntryStatus, string> = {
  draft: "text-muted-foreground",
  pending: "border-warning/50 text-warning",
  approved: "border-success/40 text-success",
  rejected: "border-destructive/40 text-destructive",
};

/** `finalRejection`: a rejected entry that is locked (not a correction request). */
export function EntryStatusBadge({ status, finalRejection = false }: { status: EntryStatus; finalRejection?: boolean }) {
  const label = entryStatusLabel(status, finalRejection);
  const className = STYLES[status];
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", className)}>
      {label}
    </Badge>
  );
}
