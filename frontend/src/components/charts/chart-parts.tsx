"use client";

/** Shared chart styling: recessive axes in muted ink, values in text tokens (never series colour). */
export const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

type TooltipEntry = { name?: string | number; value?: number | string | null; color?: string; dataKey?: string | number };

/** Hover tooltip: the label, then one row per series with a colour key and the formatted value. */
export function ChartTooltip({
  active,
  payload,
  label,
  format = (v: number) => String(v),
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  format?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
            {payload.length > 1 && <span className="size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />}
            {payload.length > 1 && <span className="text-muted-foreground">{p.name}</span>}
            <span className="ml-auto font-medium tabular-nums">
              {p.value === null || p.value === undefined ? "No data" : format(Number(p.value))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
