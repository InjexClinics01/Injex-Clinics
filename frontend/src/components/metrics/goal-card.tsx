"use client";

import { CheckCircle2, Star } from "lucide-react";
import { useActionState, useState } from "react";

import { cancelGoal } from "@/app/employee/goals/actions";
import { FormMessage } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { initialFormState } from "@/lib/auth/validation";
import { PERIOD_LABELS, formatPeriod } from "@/lib/metrics/periods";
import { formatMetricValue } from "@/lib/metrics/values";
import type { GoalProgress, MetricDefinition } from "@/types/database";
import { ProgressBar } from "./progress-bar";

type Props = {
  goal: GoalProgress;
  metric: MetricDefinition | undefined;
  estimatedPoints: number;
  /** Show the cancel action (current and upcoming goals only). */
  cancellable?: boolean;
};

export function GoalCard({ goal, metric, estimatedPoints, cancellable = false }: Props) {
  const fmt = (v: number | null) => formatMetricValue(v, metric?.data_type ?? "decimal", metric?.unit ?? null);
  const achieved = goal.percent_complete >= 100;
  // Phase 3: only approved entries count; submitted ones may still be sent back.
  const verified = goal.verified_percent >= 100;
  const name = metric?.name ?? "Metric";

  return (
    <Card size="sm">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">
              {PERIOD_LABELS[goal.period]} · {formatPeriod(goal.period, goal.period_start, goal.period_end)}
            </p>
          </div>
          {verified ? (
            <Badge variant="outline" className="border-success/40 text-success">
              <CheckCircle2 aria-hidden /> Achieved
            </Badge>
          ) : achieved ? (
            <Badge variant="outline" className="border-warning/50 text-warning">
              Awaiting approval
            </Badge>
          ) : (
            <span className="text-sm font-semibold tabular-nums">{goal.percent_complete}%</span>
          )}
        </div>

        <ProgressBar percent={goal.percent_complete} label={`${name} goal progress`} />

        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground tabular-nums">{fmt(goal.current_value ?? 0)}</span> of {fmt(goal.target_value)}
          </span>
          <span>{achieved ? "Target reached" : `${fmt(goal.remaining)} to go`}</span>
          {goal.verified_value !== goal.current_value && (
            <span className="w-full">
              Verified (approved): <span className="tabular-nums">{fmt(goal.verified_value ?? 0)}</span> · {goal.verified_percent}%
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Star className="size-3.5" aria-hidden />
            {estimatedPoints > 0 ? `Est. ${estimatedPoints} points` : "No points for this target"}
          </span>
          {cancellable && <CancelGoal goalId={goal.goal_id} />}
        </div>
      </CardContent>
    </Card>
  );
}

function CancelGoal({ goalId }: { goalId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(cancelGoal, initialFormState);

  if (!confirming) {
    return (
      <Button variant="ghost" size="xs" onClick={() => setConfirming(true)}>
        Cancel goal
      </Button>
    );
  }
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="goal_id" value={goalId} />
      {state.status === "error" && <FormMessage status="error" message={state.message} />}
      <Button type="button" variant="ghost" size="xs" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      <SubmitButton pending={pending} size="xs" variant="destructive">
        Confirm cancel
      </SubmitButton>
    </form>
  );
}
