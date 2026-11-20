import type { FieldErrors } from "@/lib/auth/validation";
import type { MetricDataType, MetricDefinition } from "@/types/database";

/**
 * Parsing, validation, calculation and formatting of daily metric values.
 * Used by the entry form (live feedback) and the server action (authoritative
 * before the database re-checks everything and computes the stored values).
 */

export type MetricValues = Record<string, number>;

const MAX_ABS_VALUE = 1e10; // numeric(14,4) limit

/**
 * Validate raw form input for the given input metrics.
 * Empty fields are "cleared" (allowed for drafts; required metrics must be
 * filled when submitting).
 */
export function parseEntryValues(
  metrics: MetricDefinition[],
  raw: Record<string, string>,
  { submitting }: { submitting: boolean },
): { values: MetricValues; cleared: string[]; errors: FieldErrors } {
  const values: MetricValues = {};
  const cleared: string[] = [];
  const errors: FieldErrors = {};

  for (const m of metrics) {
    const text = (raw[m.id] ?? "").trim().replace(/,/g, "");
    if (text === "") {
      cleared.push(m.id);
      if (submitting && m.is_required) errors[m.id] = "Required";
      continue;
    }
    const value = Number(text);
    const error = validateValue(m, text, value);
    if (error) errors[m.id] = error;
    else values[m.id] = value;
  }
  return { values, cleared, errors };
}

function validateValue(m: MetricDefinition, text: string, value: number): string | null {
  if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(value)) return "Enter a number";
  if (Math.abs(value) >= MAX_ABS_VALUE) return "Number is too large";
  if (m.data_type === "integer" && !Number.isInteger(value)) return "Enter a whole number";
  if (m.min_value !== null && value < m.min_value) return `Must be at least ${m.min_value}`;
  if (m.max_value !== null && value > m.max_value) return `Must be at most ${m.max_value}`;
  if (text.split(".")[1]?.length > 4) return "Use at most 4 decimal places";
  return null;
}

/**
 * Live preview of calculated metrics (the database computes the stored values
 * with the same rules). Division by zero or missing inputs → null.
 */
export function calculateValues(metrics: MetricDefinition[], inputs: MetricValues): Record<string, number | null> {
  const unitTotal = metrics
    .filter((m) => m.kind === "input" && m.counts_as_unit)
    .reduce((sum, m) => sum + (inputs[m.id] ?? 0), 0);

  const result: Record<string, number | null> = {};
  for (const m of metrics) {
    if (m.kind !== "calculated" || !m.is_active || !m.denominator_metric_id) continue;
    const numerator = m.numerator_is_unit_total ? unitTotal : inputs[m.numerator_metric_id ?? ""];
    const denominator = inputs[m.denominator_metric_id];
    result[m.id] = numerator === undefined || !denominator ? null : round4(numerator / denominator);
  }
  return result;
}

function round4(n: number) {
  return Math.round(n * 10_000) / 10_000;
}

/** Changes whenever any value of an entry changes; detects two admins editing the same entry. */
export function entryValuesVersion(values: { updated_at: string }[]): string {
  return values.reduce((latest, v) => (v.updated_at > latest ? v.updated_at : latest), "");
}

/** Up to `limit` headline metrics of one category: calculated ones first, then required inputs. */
export function headlineMetrics(metrics: MetricDefinition[], limit = 4): MetricDefinition[] {
  const active = metrics.filter((m) => m.is_active);
  return [...active.filter((m) => m.kind === "calculated"), ...active.filter((m) => m.kind === "input" && m.is_required)].slice(0, limit);
}

const numberFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const moneyFormat = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "$2,000.00", "$250.00/h", "80%", "5 tickets", "0.5 units/h", "—" for no value.
 * For currency the unit is "<symbol>" or "<symbol>/<per>".
 */
export function formatMetricValue(value: number | null | undefined, dataType: MetricDataType, unit: string | null): string {
  if (value === null || value === undefined) return "—";
  if (dataType === "currency") {
    const [symbol = "", per] = (unit ?? "").split("/");
    return `${symbol}${moneyFormat.format(value)}${per ? `/${per}` : ""}`;
  }
  if (dataType === "percentage") return `${numberFormat.format(value)}%`;
  return unit ? `${numberFormat.format(value)} ${unit}` : numberFormat.format(value);
}
