"use client";

import { AlertCircle, Check, CheckCircle2, Pencil, RotateCcw, X, XCircle } from "lucide-react";
import { useActionState, useState } from "react";

import { reviewEntry } from "@/app/admin/submissions/actions";
import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { useConfirmSubmit } from "@/components/forms/use-confirm-submit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useFormValidation } from "@/hooks/use-form-validation";
import { reviewConfirmation } from "@/lib/admin/confirmations";
import { initialFormState, toFieldErrors } from "@/lib/auth/validation";
import { REVIEW_NOTE_MAX, readReview, reviewSchema, type ReviewDecision } from "@/lib/review/schemas";
import { formatDateTime } from "@/lib/utils/format";
import type { EntryStatus } from "@/types/database";

type Props = {
  entryId: string;
  status: EntryStatus;
  finalRejection: boolean;
  reviewNote: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
};

/** Which decisions make sense from the current state (the database enforces the same rules). */
function availableDecisions(status: EntryStatus, finalRejection: boolean): ReviewDecision[] {
  if (status === "pending") return ["approve", "correction", "reject"];
  if (status === "approved") return ["correction", "reject"];
  if (status === "rejected") return finalRejection ? ["approve", "correction"] : ["approve", "reject"];
  return [];
}

const CURRENT_DESCRIPTIONS: Record<string, string> = {
  pending: "Waiting for your review.",
  approved: "Approved. It counts towards verified performance.",
  correction: "Sent back for correction. The employee can edit and resubmit.",
  rejected: "Rejected. Locked for the employee and not counted.",
};

export function ReviewPanel({ entryId, status, finalRejection, reviewNote, reviewerName, reviewedAt }: Props) {
  const [state, action, pending] = useActionState(reviewEntry, initialFormState);
  const [activeDecision, setActiveDecision] = useState<"approve" | "correction" | "reject" | null>(null);
  const [isChangingDecision, setIsChangingDecision] = useState(false);
  const [lastHandledState, setLastHandledState] = useState(state);

  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.status === "success") {
      setIsChangingDecision(false);
    }
  }

  const validate = (fd: FormData) => {
    const parsed = reviewSchema.safeParse(readReview(fd));
    return parsed.success ? null : toFieldErrors(parsed.error);
  };

  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);
  const confirm = useConfirmSubmit((fd) => reviewConfirmation(status, fd));
  const decisions = availableDecisions(status, finalRejection);
  const currentKey = status === "rejected" ? (finalRejection ? "rejected" : "correction") : status;
  const isDecided = status !== "pending";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review</CardTitle>
        <CardDescription>{CURRENT_DESCRIPTIONS[currentKey]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {showServerMessage && <FormMessage status={state.status} message={state.message} />}

        {/* DECIDED STATE (Summary Banner) */}
        {isDecided && !isChangingDecision && (
          <div className="space-y-4">
            {status === "approved" && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-50/60 p-4 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-100">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold">Submission Approved</p>
                    <p className="text-xs text-muted-foreground">
                      Reviewed by {reviewerName ?? "an administrator"} · {reviewedAt ? formatDateTime(reviewedAt) : "Recently"}
                    </p>
                    {reviewNote && (
                      <p className="mt-2 text-xs italic text-muted-foreground">“{reviewNote}”</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {status === "rejected" && !finalRejection && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-50/60 p-4 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold">Sent Back for Correction</p>
                    <p className="text-xs text-muted-foreground">
                      Requested by {reviewerName ?? "an administrator"} · {reviewedAt ? formatDateTime(reviewedAt) : "Recently"}
                    </p>
                    {reviewNote && (
                      <p className="mt-2 rounded bg-amber-100/60 p-2 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                        <strong>Reason:</strong> “{reviewNote}”
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {status === "rejected" && finalRejection && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
                <div className="flex items-start gap-3">
                  <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold">Submission Rejected</p>
                    <p className="text-xs text-muted-foreground">
                      Rejected by {reviewerName ?? "an administrator"} · {reviewedAt ? formatDateTime(reviewedAt) : "Recently"}
                    </p>
                    {reviewNote && (
                      <p className="mt-2 rounded bg-destructive/10 p-2 text-xs">
                        <strong>Reason:</strong> “{reviewNote}”
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {decisions.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsChangingDecision(true)}
                className="w-full text-xs"
              >
                <Pencil className="size-3.5" aria-hidden />
                Change decision
              </Button>
            )}
          </div>
        )}

        {/* ACTIVE FORM: Shown when pending OR when admin explicitly clicks "Change decision" */}
        {(!isDecided || isChangingDecision) && (
          <form action={action} {...formProps} onSubmit={confirm.wrap(formProps.onSubmit)} className="space-y-4">
            <input type="hidden" name="entry_id" value={entryId} />
            {errors.decision && <FormMessage status="error" message={errors.decision} />}

            <FormField
              id="note"
              label="Note to the employee"
              error={errors.note}
              hint="Required when rejecting or requesting a correction. Optional when approving."
            >
              <Textarea
                {...fieldA11y("note", errors.note, "hint")}
                name="note"
                rows={3}
                maxLength={REVIEW_NOTE_MAX}
                defaultValue={state.values?.note ?? ""}
                key={state.status === "success" ? state.message : "note"}
                placeholder="e.g. Ticket count doesn't match the till report"
              />
            </FormField>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {decisions.includes("approve") && (
                <SubmitButton
                  pending={pending && activeDecision === "approve"}
                  disabled={pending}
                  onClick={() => setActiveDecision("approve")}
                  name="decision"
                  value="approve"
                  className="h-10 sm:flex-1"
                >
                  <Check aria-hidden /> Approve
                </SubmitButton>
              )}
              {decisions.includes("correction") && (
                <SubmitButton
                  pending={pending && activeDecision === "correction"}
                  disabled={pending}
                  onClick={() => setActiveDecision("correction")}
                  name="decision"
                  value="correction"
                  variant="outline"
                  className="h-10 sm:flex-1"
                >
                  <RotateCcw aria-hidden /> Request correction
                </SubmitButton>
              )}
              {decisions.includes("reject") && (
                <SubmitButton
                  pending={pending && activeDecision === "reject"}
                  disabled={pending}
                  onClick={() => setActiveDecision("reject")}
                  name="decision"
                  value="reject"
                  variant="destructive"
                  className="h-10 sm:flex-1"
                >
                  <X aria-hidden /> Reject
                </SubmitButton>
              )}
            </div>

            {isChangingDecision && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsChangingDecision(false)}
                className="w-full text-xs text-muted-foreground"
              >
                Cancel
              </Button>
            )}

            {confirm.dialog}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
