"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AXIS_TICK, ChartTooltip } from "./chart-parts";

export type SubmissionBar = { label: string; approved: number; pending: number; rejected: number };

/**
 * Submissions per day, stacked by status. Status colours are reserved chart
 * tokens (validated for colour-vision deficiency) and always paired with the
 * legend labels; a table view sits next to the chart.
 */
const SERIES = [
  { key: "approved", name: "Approved", color: "var(--chart-approved)" },
  { key: "pending", name: "Pending", color: "var(--chart-pending)" },
  { key: "rejected", name: "Sent back / rejected", color: "var(--chart-rejected)" },
] as const;

export function SubmissionsBarChart({ data, summary }: { data: SubmissionBar[]; summary: string }) {
  return (
    <div role="img" aria-label={summary} className="h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={12} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} width={32} />
          <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip />} />
          <Legend
            iconType="square"
            iconSize={10}
            formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
          />
          {SERIES.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="status"
              fill={s.color}
              stroke="var(--card)"
              strokeWidth={2}
              radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
