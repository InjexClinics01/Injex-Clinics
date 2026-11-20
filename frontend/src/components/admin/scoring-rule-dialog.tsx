"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { saveScoringRule } from "@/app/admin/goals/actions";
import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { useConfirmSubmit } from "@/components/forms/use-confirm-submit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useFormValidation } from "@/hooks/use-form-validation";
import { scoringRuleConfirmation } from "@/lib/admin/confirmations";
import { initialFormState, validator } from "@/lib/auth/validation";
import { PERIOD_LABELS } from "@/lib/metrics/periods";
import { readScoringRule, scoringRuleSchema } from "@/lib/metrics/schemas";
import type { GoalPeriod, MetricDefinition, ScoringRule } from "@/types/database";

const validate = validator(scoringRuleSchema, readScoringRule);

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: ScoringRule;
  /** Scoring-eligible metrics of the category. */
  metrics: MetricDefinition[];
};

export function ScoringRuleDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        {props.open && <RuleForm key={props.rule?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function RuleForm({ onOpenChange, rule, metrics }: Props) {
  const [state, action, pending] = useActionState(saveScoringRule, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);
  const confirm = useConfirmSubmit((fd) => scoringRuleConfirmation(rule, fd));
  const v = state.values ?? {};

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onOpenChange(false);
    }
  }, [state, onOpenChange]);

  return (
    <form action={action} {...formProps} onSubmit={confirm.wrap(formProps.onSubmit)} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{rule ? "Edit scoring rule" : "Add scoring rule"}</DialogTitle>
        <DialogDescription>
          Reaching the threshold for the period earns the points. Add several thresholds for tiers; the highest reached applies.
        </DialogDescription>
      </DialogHeader>
      {showServerMessage && state.status === "error" && <FormMessage status="error" message={state.message} />}
      <input type="hidden" name="id" value={rule?.id ?? ""} />

      <FormField id="metric_id" label="Metric" error={errors.metric_id} hint={rule ? "Cannot be changed" : undefined}>
        <NativeSelect {...fieldA11y("metric_id", errors.metric_id)} name="metric_id" defaultValue={v.metric_id ?? rule?.metric_id ?? ""} disabled={Boolean(rule)}>
          <option value="">Choose…</option>
          {metrics.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.unit ? ` (${m.unit})` : ""}
            </option>
          ))}
        </NativeSelect>
        {rule && <input type="hidden" name="metric_id" value={rule.metric_id} />}
      </FormField>

      <FormField id="period" label="Period" error={errors.period}>
        <NativeSelect {...fieldA11y("period", errors.period)} name="period" defaultValue={v.period ?? rule?.period ?? "daily"}>
          {(Object.keys(PERIOD_LABELS) as GoalPeriod[]).map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="threshold" label="Threshold" error={errors.threshold}>
          <Input {...fieldA11y("threshold", errors.threshold)} name="threshold" inputMode="decimal" maxLength={16} defaultValue={v.threshold ?? rule?.threshold ?? ""} placeholder="e.g. 80" />
        </FormField>
        <FormField id="points" label="Points" error={errors.points}>
          <Input {...fieldA11y("points", errors.points)} name="points" inputMode="numeric" maxLength={6} defaultValue={v.points ?? rule?.points ?? ""} placeholder="e.g. 100" />
        </FormField>
      </div>

      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={v.is_active !== undefined ? v.is_active === "on" : (rule?.is_active ?? true)}
          className="size-4 accent-primary"
        />
        Active
      </label>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          {rule ? "Save changes" : "Add rule"}
        </SubmitButton>
      </DialogFooter>
      {confirm.dialog}
    </form>
  );
}
