"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { decideRedemption } from "@/app/admin/rewards/actions";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Pagination } from "@/components/dashboard/pagination";
import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useFormValidation } from "@/hooks/use-form-validation";
import { initialFormState, validator } from "@/lib/auth/validation";
import { REDEMPTION_TABS, formatPoints, readRedemptionDecision, redemptionDecisionSchema, type RedemptionTab } from "@/lib/points/schemas";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils/format";
import type { RedemptionDecision, RedemptionStatus } from "@/types/database";
import type { RedemptionRow } from "@/services/points";
import { RedemptionStatusBadge } from "./redemption-status-badge";

const validate = validator(redemptionDecisionSchema, readRedemptionDecision);

const DECISIONS: Record<RedemptionDecision, { label: string; title: string; text: string; noteRequired: boolean; variant?: "outline" | "destructive" }> = {
  approve: {
    label: "Approve",
    title: "Approve this request?",
    text: "The points are deducted now and stock is reduced by one.",
    noteRequired: false,
  },
  reject: {
    label: "Reject",
    title: "Reject this request?",
    text: "The reserved points are released. The employee sees your reason.",
    noteRequired: true,
    variant: "destructive",
  },
  fulfil: { label: "Mark handed over", title: "Mark as handed over?", text: "Confirms the employee has received the reward.", noteRequired: false },
  refund: {
    label: "Refund",
    title: "Cancel and refund?",
    text: "The points are returned to the employee and stock goes back up by one.",
    noteRequired: true,
    variant: "outline",
  },
};

const ACTIONS: Partial<Record<RedemptionStatus, RedemptionDecision[]>> = {
  pending: ["approve", "reject"],
  approved: ["fulfil", "refund"],
};

const tabHref = (tab: RedemptionTab, page = 1) =>
  `/admin/rewards?${new URLSearchParams({ tab, ...(page > 1 && { page: String(page) }) })}`;

export function RedemptionQueue({
  rows,
  tab,
  counts,
  page,
  pageSize,
  total,
}: {
  rows: RedemptionRow[];
  tab: RedemptionTab;
  /** Open requests per tab (the completed tab has no count). */
  counts: Partial<Record<RedemptionTab, number>>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const [decision, setDecision] = useState<{ row: RedemptionRow; decision: RedemptionDecision } | null>(null);

  return (
    <Card className="pb-0">
      <CardHeader>
        <CardTitle>Redemption requests</CardTitle>
        <CardDescription>Approve to deduct points, then mark as handed over once the employee has the reward.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <nav aria-label="Show requests" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1">
          {(Object.keys(REDEMPTION_TABS) as RedemptionTab[]).map((key) => (
            <Link
              key={key}
              href={tabHref(key)}
              aria-current={tab === key ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                tab === key && "bg-background text-foreground shadow-sm",
              )}
            >
              {REDEMPTION_TABS[key].label}
              {(counts[key] ?? 0) > 0 && <span className="ml-1.5 tabular-nums">({counts[key]})</span>}
            </Link>
          ))}
        </nav>

        {rows.length === 0 ? (
          <EmptyState icon={Inbox} title="Nothing here" description="Requests will appear here as employees redeem rewards." className="py-8" />
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{r.employee?.full_name || r.employee?.email || "Employee"}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{r.reward_name}</span>
                    <RedemptionStatusBadge status={r.status} />
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatPoints(r.points_cost)} pts · requested {formatDateTime(r.requested_at)}
                    {r.fulfilled_at && ` · handed over ${formatDateTime(r.fulfilled_at)}`}
                  </p>
                  {r.admin_note && <p className="text-xs whitespace-pre-line">Note: {r.admin_note}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {(ACTIONS[r.status] ?? []).map((d) => (
                    <Button key={d} size="sm" variant={DECISIONS[d].variant ?? "default"} onClick={() => setDecision({ row: r, decision: d })}>
                      {DECISIONS[d].label}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => tabHref(tab, p)} />
      <Dialog open={decision !== null} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent className="sm:max-w-md">
          {decision && <DecisionForm key={`${decision.row.id}-${decision.decision}`} {...decision} onDone={() => setDecision(null)} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DecisionForm({ row, decision, onDone }: { row: RedemptionRow; decision: RedemptionDecision; onDone: () => void }) {
  const [state, action, pending] = useActionState(decideRedemption, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);
  const config = DECISIONS[decision];
  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={action} {...formProps} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{config.title}</DialogTitle>
        <DialogDescription>
          {row.employee?.full_name ?? "Employee"} · {row.reward_name} · {formatPoints(row.points_cost)} pts. {config.text}
        </DialogDescription>
      </DialogHeader>
      {showServerMessage && state.status === "error" && <FormMessage status="error" message={state.message} />}
      <input type="hidden" name="redemption_id" value={row.id} />
      <input type="hidden" name="decision" value={decision} />
      <FormField id="note" label={config.noteRequired ? "Reason" : "Note (optional)"} error={errors.note}>
        <Textarea {...fieldA11y("note", errors.note)} name="note" rows={3} maxLength={500} defaultValue={state.values?.note ?? ""} />
      </FormField>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Back</DialogClose>
        <SubmitButton pending={pending} pendingLabel="Saving…" variant={config.variant === "destructive" ? "destructive" : "default"}>
          {config.label}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
