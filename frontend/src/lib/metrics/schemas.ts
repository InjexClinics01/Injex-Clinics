import { z } from "zod";

/** Validation for metric, scoring-rule and goal forms (browser + server). */

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const checked = (fd: FormData, key: string) => fd.get(key) === "on";

const optionalNumber = z
  .string()
  .transform((v) => (v === "" ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && Math.abs(v) < 1e10), "Enter a number");

const positiveNumber = z
  .string()
  .min(1, "Required")
  .transform(Number)
  .refine((v) => Number.isFinite(v) && v > 0 && v < 1e10, "Enter a number greater than 0");

const period = z.enum(["daily", "weekly", "monthly"], { error: "Choose a period" });
const uuid = z.uuid({ error: "Choose an option" });

// -----------------------------------------------------------------------------
// Metric definitions
// -----------------------------------------------------------------------------
export const metricSchema = z
  .object({
    id: z.union([z.literal(""), z.uuid()]),
    category: z.string().regex(/^[a-z][a-z0-9_]{1,49}$/, "Unknown category"),
    name: z
      .string()
      .min(2, "Enter a name (at least 2 characters)")
      .max(80, "Name must be 80 characters or fewer")
      .refine((v) => !/[\u0000-\u001F\u007F]/.test(v), "Name contains invalid characters"),
    description: z.string().max(300, "Description must be 300 characters or fewer"),
    kind: z.enum(["input", "calculated"]),
    data_type: z.enum(["integer", "decimal", "currency", "percentage"], { error: "Choose a type" }),
    unit: z.string().max(20, "Unit must be 20 characters or fewer"),
    aggregation: z.enum(["sum", "average"]),
    min_value: optionalNumber,
    max_value: optionalNumber,
    default_target: optionalNumber.refine((v) => v === null || v > 0, "Target must be greater than 0"),
    numerator: z.string(), // metric id or "units"
    denominator_metric_id: z.string(),
    sort_order: z.coerce.number().int("Whole number").min(0).max(10000),
    is_required: z.boolean(),
    counts_as_unit: z.boolean(),
    is_goal_eligible: z.boolean(),
    is_scoring_eligible: z.boolean(),
    is_active: z.boolean(),
  })
  .refine((v) => v.min_value === null || v.max_value === null || v.min_value <= v.max_value, {
    path: ["max_value"],
    message: "Maximum must be greater than or equal to minimum",
  })
  .refine((v) => v.kind === "input" || v.denominator_metric_id !== "", {
    path: ["denominator_metric_id"],
    message: "Choose what to divide by",
  })
  .refine((v) => v.kind === "input" || v.numerator !== "", { path: ["numerator"], message: "Choose what to divide" });

export type MetricInput = z.infer<typeof metricSchema>;

export const readMetric = (fd: FormData) => ({
  id: str(fd, "id"),
  category: str(fd, "category"),
  name: str(fd, "name").replace(/\s+/g, " "),
  description: str(fd, "description"),
  kind: str(fd, "kind") || "input",
  data_type: str(fd, "data_type"),
  unit: str(fd, "unit"),
  aggregation: str(fd, "aggregation") || "sum",
  min_value: str(fd, "min_value"),
  max_value: str(fd, "max_value"),
  default_target: str(fd, "default_target"),
  numerator: str(fd, "numerator"),
  denominator_metric_id: str(fd, "denominator_metric_id"),
  sort_order: str(fd, "sort_order") || "0",
  is_required: checked(fd, "is_required"),
  counts_as_unit: checked(fd, "counts_as_unit"),
  is_goal_eligible: checked(fd, "is_goal_eligible"),
  is_scoring_eligible: checked(fd, "is_scoring_eligible"),
  is_active: checked(fd, "is_active"),
});

/** Stable machine key from a display name: "Rebooking %" → "rebooking". */
export function metricKeyFromName(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/%/g, " pct ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "m_$1")
    .slice(0, 40);
  return key.length >= 2 ? key : `metric_${key}`;
}

// -----------------------------------------------------------------------------
// Scoring rules
// -----------------------------------------------------------------------------
export const scoringRuleSchema = z.object({
  id: z.union([z.literal(""), z.uuid()]),
  metric_id: uuid,
  period,
  threshold: z
    .string()
    .min(1, "Required")
    .transform(Number)
    .refine((v) => Number.isFinite(v) && v >= 0 && v < 1e10, "Enter a number of 0 or more"),
  points: z
    .string()
    .min(1, "Required")
    .transform(Number)
    .refine((v) => Number.isInteger(v) && v >= 1 && v <= 100000, "Enter whole points between 1 and 100,000"),
  is_active: z.boolean(),
});

export const readScoringRule = (fd: FormData) => ({
  id: str(fd, "id"),
  metric_id: str(fd, "metric_id"),
  period: str(fd, "period"),
  threshold: str(fd, "threshold"),
  points: str(fd, "points"),
  is_active: checked(fd, "is_active"),
});

// -----------------------------------------------------------------------------
// Goals
// -----------------------------------------------------------------------------
export const goalSchema = z.object({
  metric_id: uuid,
  period,
  when: z.enum(["current", "next"], { error: "Choose when the goal applies" }),
  target_value: positiveNumber,
});

export const readGoal = (fd: FormData) => ({
  metric_id: str(fd, "metric_id"),
  period: str(fd, "period"),
  when: str(fd, "when") || "current",
  target_value: str(fd, "target_value").replace(/,/g, ""),
});
