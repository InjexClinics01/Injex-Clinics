"use client";

import { Calendar, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { formatDay } from "@/lib/metrics/periods";
import type { EmployeeSubmissionDate } from "@/services/review";

type Props = {
  currentEntryId: string;
  dates: EmployeeSubmissionDate[];
};

function statusLabel(status: string, finalRejection: boolean): string {
  if (status === "approved") return "Approved";
  if (status === "pending") return "Pending";
  if (status === "rejected") {
    return finalRejection ? "Rejected" : "Needs correction";
  }
  return status;
}

export function SubmissionDateSelector({ currentEntryId, dates }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (dates.length <= 1) {
    return null;
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const targetId = e.target.value;
    if (targetId && targetId !== currentEntryId) {
      startTransition(() => {
        router.push(`/admin/submissions/${targetId}`);
      });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
        <Calendar className="size-4" aria-hidden />
        Previous entries:
      </span>
      <div className="relative inline-block">
        <select
          value={currentEntryId}
          onChange={handleChange}
          disabled={isPending}
          aria-label="Select previous submission date"
          className="h-8 cursor-pointer rounded-md border border-input bg-background pl-2.5 pr-8 text-xs font-medium shadow-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          {dates.map((d, index) => {
            const isLatest = index === 0;
            const label = `${formatDay(d.entry_date)} · ${statusLabel(d.status, d.final_rejection)}${isLatest ? " (Latest)" : ""}`;
            return (
              <option key={d.id} value={d.id}>
                {label}
              </option>
            );
          })}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      </div>
      <span className="text-xs text-muted-foreground">
        ({dates.length} entries available)
      </span>
    </div>
  );
}
