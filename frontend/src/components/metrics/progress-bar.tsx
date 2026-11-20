import { cn } from "@/lib/utils";

/** Accessible progress bar; the fill is capped at 100% but the label shows the real value. */
export function ProgressBar({ percent, label, className }: { percent: number; label: string; className?: string }) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${percent}%`}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", percent >= 100 ? "bg-success" : "bg-primary")}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
