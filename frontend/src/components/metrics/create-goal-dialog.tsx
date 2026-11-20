"use client";

import { Plus, Star } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { createGoal } from "@/app/employee/goals/actions";
import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useFormValidation } from "@/hooks/use-form-validation";
import { initialFormState, validator } from "@/lib/auth/validation";
import { PERIOD_LABELS, formatPeriod, nextPeriodStart, periodEnd, periodStart } from "@/lib/metrics/periods";
import { estimateGoalPoints } from "@/lib/metrics/points";
import { goalSchema, readGoal } from "@/lib/metrics/schemas";
import { formatMetricValue } from "@/lib/metrics/values";
import type { GoalPeriod, MetricDefinition, ScoringRule } from "@/types/database";

const validate = validator(goalSchema, readGoal);
const PERIODS: GoalPeriod[] = ["daily", "weekly", "monthly"];

type Props = { metrics: MetricDefinition[]; rules: ScoringRule[]; today: string };

export function CreateGoalDialog(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button disabled={props.metrics.length === 0} />}>
        <Plus /> New goal
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {open && <GoalForm {...props} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function GoalForm({ metrics, rules, today, onDone }: Props & { onDone: () => void }) {
  const [state, action, pending] = useActionState(createGoal, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);
  const [metricId, setMetricId] = useState(metrics[0]?.id ?? "");
  const [period, setPeriod] = useState<GoalPeriod>("weekly");
  const [when, setWhen] = useState<"current" | "next">("current");
  const [target, setTarget] = useState("");

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onDone();
    }
  }, [state, onDone]);

  const metric = metrics.find((m) => m.id === metricId);
  const fmt = (v: number) => formatMetricValue(v, metric?.data_type ?? "decimal", metric?.unit ?? null);
  const start = when === "next" ? nextPeriodStart(period, today) : periodStart(period, today);
  const targetValue = Number(target);
  const estimate = metric && targetValue > 0 ? estimateGoalPoints(rules, metric.id, period, targetValue) : null;
  const periodLabel = (w: "current" | "next") => {
    const s = w === "next" ? nextPeriodStart(period, today) : periodStart(period, today);
    return formatPeriod(period, s, periodEnd(period, s));
  };

  return (
    <form action={action} {...formProps} className="space-y-5">
      <DialogHeader>
        <DialogTitle>New goal</DialogTitle>
        <DialogDescription>Set a target for one of your metrics. Goals can be cancelled but not edited.</DialogDescription>
      </DialogHeader>
      {showServerMessage && state.status === "error" && <FormMessage status="error" message={state.message} />}

      <FormField id="metric_id" label="Metric" error={errors.metric_id}>
        <NativeSelect {...fieldA11y("metric_id", errors.metric_id)} name="metric_id" value={metricId} onChange={(e) => setMetricId(e.target.value)}>
          {metrics.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="period" label="Period" error={errors.period}>
          <NativeSelect {...fieldA11y("period", errors.period)} name="period" value={period} onChange={(e) => setPeriod(e.target.value as GoalPeriod)}>
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="when" label="Applies to" error={errors.when}>
          <NativeSelect {...fieldA11y("when", errors.when)} name="when" value={when} onChange={(e) => setWhen(e.target.value as "current" | "next")}>
            <option value="current">This period ({periodLabel("current")})</option>
            <option value="next">Next period ({periodLabel("next")})</option>
          </NativeSelect>
        </FormField>
      </div>

      <FormField
        id="target_value"
        label={`Target${metric?.unit ? ` (${metric.unit})` : ""}`}
        error={errors.target_value}
        hint={metric?.default_target ? `Suggested daily target: ${fmt(metric.default_target)}` : undefined}
      >
        <Input
          {...fieldA11y("target_value", errors.target_value)}
          name="target_value"
          inputMode="decimal"
          autoComplete="off"
          maxLength={16}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="e.g. 80"
        />
      </FormField>

      <div className="flex gap-3 rounded-lg border bg-muted/30 p-3 text-sm" aria-live="polite">
        <Star className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div>
          <p className="font-medium">{pointsMessage(estimate, fmt)}</p>
          <p className="text-xs text-muted-foreground">
            For {formatPeriod(period, start, periodEnd(period, start))}. Credited when the period ends, from approved entries only. Goals
            earn points only if set before you submit any entry for that period.
          </p>
        </div>
      </div>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <SubmitButton pending={pending} pendingLabel="Creating…">
          Create goal
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

function pointsMessage(estimate: ReturnType<typeof estimateGoalPoints> | null, fmt: (v: number) => string) {
  if (!estimate) return "Enter a target to see potential points.";
  if (estimate.points > 0) return `Achieving this goal could earn ${estimate.points} points.`;
  if (estimate.next) return `No points yet: set a target of ${fmt(estimate.next.threshold)} or more to earn ${estimate.next.points} points.`;
  return "No scoring rules apply to this metric and period.";
}
