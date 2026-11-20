"use client";

import { Calculator, Pencil, Plus, SlidersHorizontal, Star } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PERIOD_LABELS } from "@/lib/metrics/periods";
import { formatMetricValue } from "@/lib/metrics/values";
import type { MetricDefinition, ScoringRule } from "@/types/database";
import { MetricFormDialog } from "./metric-form-dialog";
import { ScoringRuleDialog } from "./scoring-rule-dialog";

const TYPE_LABELS = { integer: "Whole number", decimal: "Decimal", currency: "Money", percentage: "Percentage" };

export function MetricsConfig({ category, metrics, rules }: { category: string; metrics: MetricDefinition[]; rules: ScoringRule[] }) {
  const [metricDialog, setMetricDialog] = useState<{ open: boolean; metric?: MetricDefinition }>({ open: false });
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; rule?: ScoringRule }>({ open: false });
  const metricById = new Map(metrics.map((m) => [m.id, m]));
  const inputMetrics = metrics.filter((m) => m.kind === "input" && m.is_active);
  const scoringMetrics = metrics.filter((m) => m.is_scoring_eligible && m.is_active);

  return (
    <div className="space-y-6">
      <Card className="pb-0">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Daily form metrics</CardTitle>
            <CardDescription>Fields staff fill in each day, and values calculated from them. Disable instead of deleting to keep history.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setMetricDialog({ open: true })}>
            <Plus /> Add metric
          </Button>
        </CardHeader>
        {metrics.length === 0 ? (
          <EmptyState
            icon={SlidersHorizontal}
            title="No metrics configured"
            description="Add the fields this role should report each day. Staff will see the form as soon as one metric is active."
          />
        ) : (
          <ul className="divide-y border-t">
            {metrics.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {m.kind === "calculated" && <Calculator className="size-4 text-primary" aria-label="Calculated" />}
                    {m.name}
                    {!m.is_active && <Badge variant="outline">Disabled</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {TYPE_LABELS[m.data_type]}
                    {m.unit && ` · ${m.unit}`}
                    {m.kind === "calculated" && ` · ${formula(m, metricById)}`}
                    {m.default_target !== null && ` · target ${formatMetricValue(m.default_target, m.data_type, m.unit)}`}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {m.is_required && <Badge variant="secondary">Required</Badge>}
                    {m.counts_as_unit && <Badge variant="secondary">Treatment unit</Badge>}
                    {m.is_goal_eligible && <Badge variant="secondary">Goals</Badge>}
                    {m.is_scoring_eligible && <Badge variant="secondary">Points</Badge>}
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setMetricDialog({ open: true, metric: m })} aria-label={`Edit ${m.name}`}>
                  <Pencil />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="pb-0">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Scoring rules</CardTitle>
            <CardDescription>Points are credited automatically from approved results: per metric, the highest tier reached each day, week or month. Achieved goals earn the tier their target reaches.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setRuleDialog({ open: true })} disabled={scoringMetrics.length === 0}>
            <Plus /> Add rule
          </Button>
        </CardHeader>
        {rules.length === 0 ? (
          <EmptyState
            icon={Star}
            title="No scoring rules"
            description={
              scoringMetrics.length
                ? "Add a rule such as “Rebooking % reaches 80 in a day = 100 points”."
                : "Mark at least one metric as “Can earn points” first."
            }
          />
        ) : (
          <ul className="divide-y border-t">
            {rules.map((r) => {
              const m = metricById.get(r.metric_id);
              return (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {m?.name} reaches {formatMetricValue(r.threshold, m?.data_type ?? "decimal", m?.unit ?? null)}
                      {!r.is_active && <Badge variant="outline">Disabled</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{PERIOD_LABELS[r.period]} goal</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{r.points} pts</span>
                  <Button variant="ghost" size="icon-sm" onClick={() => setRuleDialog({ open: true, rule: r })} aria-label="Edit rule">
                    <Pencil />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <MetricFormDialog
        open={metricDialog.open}
        onOpenChange={(open) => setMetricDialog((d) => ({ ...d, open }))}
        category={category}
        metric={metricDialog.metric}
        inputMetrics={inputMetrics}
      />
      <ScoringRuleDialog
        open={ruleDialog.open}
        onOpenChange={(open) => setRuleDialog((d) => ({ ...d, open }))}
        rule={ruleDialog.rule}
        metrics={scoringMetrics}
      />
    </div>
  );
}

function formula(m: MetricDefinition, byId: Map<string, MetricDefinition>) {
  const a = m.numerator_is_unit_total ? "Treatment units" : byId.get(m.numerator_metric_id ?? "")?.name;
  return `${a} ÷ ${byId.get(m.denominator_metric_id ?? "")?.name}`;
}
