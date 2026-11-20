"use client";

import { PackageOpen } from "lucide-react";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { cancelRedemption } from "@/app/employee/rewards/actions";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SubmitButton } from "@/components/forms/submit-button";
import { initialFormState } from "@/lib/auth/validation";
import { formatPoints } from "@/lib/points/schemas";
import { formatDateTime } from "@/lib/utils/format";
import type { RewardRedemption } from "@/types/database";
import { RedemptionStatusBadge } from "./redemption-status-badge";

/** The employee's own requests with status, admin note and a cancel option while pending. */
export function MyRedemptions({ rows, compact = false }: { rows: RewardRedemption[]; compact?: boolean }) {
  if (rows.length === 0) {
    return <EmptyState icon={PackageOpen} title="No requests yet" description="Rewards you redeem will appear here." className="py-8" />;
  }
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {r.reward_name}
              <RedemptionStatusBadge status={r.status} />
            </p>
            <p className="text-xs text-muted-foreground">
              {formatPoints(r.points_cost)} pts · requested {formatDateTime(r.requested_at)}
            </p>
            {!compact && r.admin_note && <p className="text-xs whitespace-pre-line">Note: {r.admin_note}</p>}
          </div>
          {!compact && r.status === "pending" && <CancelButton id={r.id} />}
        </li>
      ))}
    </ul>
  );
}

function CancelButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelRedemption, initialFormState);
  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    if (state.status === "error") toast.error(state.message);
  }, [state]);
  return (
    <form action={action}>
      <input type="hidden" name="redemption_id" value={id} />
      <SubmitButton pending={pending} pendingLabel="Cancelling…" variant="outline" size="sm">
        Cancel request
      </SubmitButton>
    </form>
  );
}
