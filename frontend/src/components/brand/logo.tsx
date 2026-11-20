import { Activity } from "lucide-react";

import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function Logo({ className, showName = true }: { className?: string; showName?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
        <Activity className="size-4.5" strokeWidth={2.5} />
      </span>
      {showName && <span className="text-base">{APP_NAME}</span>}
    </span>
  );
}
