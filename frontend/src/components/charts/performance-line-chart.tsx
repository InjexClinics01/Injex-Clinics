"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatMetricValue } from "@/lib/metrics/values";
import type { MetricDataType } from "@/types/database";
import { AXIS_TICK, ChartTooltip } from "./chart-parts";

export type LinePoint = { label: string; value: number | null };

/**
 * One metric over time (single series: the card title names it, so no legend).
 * Optional dashed target line (goal or default target), labelled directly. Gaps where there is no approved data.
 */
export function PerformanceLineChart({
  data,
  dataType,
  unit,
  target,
  summary,
}: {
  data: LinePoint[];
  dataType: MetricDataType;
  unit: string | null;
  target?: number | null;
  /** Text alternative for screen readers. */
  summary: string;
}) {
  const format = (v: number) => formatMetricValue(v, dataType, unit);
  return (
    <div role="img" aria-label={summary} className="h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={72}
            tickFormatter={format}
            domain={[0, (max: number) => Math.max(max, target ?? 0) * 1.1 || 1]}
          />
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
            content={<ChartTooltip format={format} />}
          />
          {target ? (
            <ReferenceLine
              y={target}
              stroke="var(--muted-foreground)"
              strokeDasharray="6 4"
              label={{ value: `Target ${format(target)}`, position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 12 }}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="value"
            name="Value"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={{ r: 4, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }}
            activeDot={{ r: 6, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
