"use client";

import { Calculator, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import { saveEntry, withdrawEntry } from "@/app/employee/daily-entry/actions";
import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormValidation } from "@/hooks/use-form-validation";
import { initialFormState } from "@/lib/auth/validation";
import { calculateValues, formatMetricValue, parseEntryValues } from "@/lib/metrics/values";
import type { EntryWithValues } from "@/services/metrics";
import type { MetricDefinition } from "@/types/database";
import { EntryStatusBadge } from "./entry-status-badge";

type Props = {
  date: string;
  today: string;
  /** Active metrics of the employee's category (input + calculated). */
  metrics: MetricDefinition[];
  entry: EntryWithValues | null;
};

export function DailyEntryForm({ date, today, metrics, entry }: Props) {
  const router = useRouter();
  const editable = !entry || entry.status === "draft" || (entry.status === "rejected" && !entry.final_rejection);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Label htmlFor="entry_date">Date</Label>
            <Input
              id="entry_date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && router.push(`/employee/daily-entry?date=${e.target.value}`)}
              className="w-full sm:w-48"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            Status:{" "}
            {entry ? <EntryStatusBadge status={entry.status} finalRejection={entry.final_rejection} /> : <span>Not started</span>}
          </div>
        </CardContent>
      </Card>

      {entry?.status === "rejected" && !entry.final_rejection && (
        <FormMessage
          status="error"
          message={`Correction requested${entry.review_note ? `: ${entry.review_note}` : ""}. Update the values and submit again.`}
        />
      )}

      {editable ? (
        <EditableEntry key={date} date={date} metrics={metrics} entry={entry} />
      ) : (
        <LockedEntry entry={entry!} metrics={metrics} />
      )}
    </div>
  );
}

function EditableEntry({ date, metrics, entry }: Omit<Props, "today">) {
  const inputs = metrics.filter((m) => m.kind === "input");
  const calculated = metrics.filter((m) => m.kind === "calculated");
  const [raw, setRaw] = useState<Record<string, string>>(() =>
    Object.fromEntries(inputs.map((m) => [m.id, valueText(entry?.values.find((v) => v.metric_id === m.id)?.value)])),
  );
  const [activeIntent, setActiveIntent] = useState<"draft" | "submit" | null>(null);

  const [state, action, pending] = useActionState(saveEntry, initialFormState);
  const validate = (fd: FormData) => {
    const { errors } = parseEntryValues(inputs, Object.fromEntries(inputs.map((m) => [m.id, String(fd.get(m.id) ?? "")])), {
      submitting: fd.get("intent") === "submit",
    });
    return Object.keys(errors).length ? errors : null;
  };
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);

  const preview = calculateValues(metrics, parseEntryValues(inputs, raw, { submitting: false }).values);

  return (
    <form action={action} {...formProps} className="space-y-6">
      <input type="hidden" name="entry_date" value={date} />
      {showServerMessage && <FormMessage status={state.status} message={state.message} />}

      <Card>
        <CardHeader>
          <CardTitle>Daily figures</CardTitle>
          <CardDescription>Fields marked * are required to submit. You can save a draft at any time.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {inputs.map((m) => {
            const hint = m.default_target ? `Target: ${formatMetricValue(m.default_target, m.data_type, m.unit)}` : undefined;
            return (
              <FormField key={m.id} id={m.id} label={`${m.name}${m.is_required ? " *" : ""}`} error={errors[m.id]} hint={hint}>
                <div className="relative">
                  <Input
                    {...fieldA11y(m.id, errors[m.id], hint)}
                    name={m.id}
                    inputMode={m.data_type === "integer" ? "numeric" : "decimal"}
                    autoComplete="off"
                    maxLength={16}
                    value={raw[m.id]}
                    onChange={(e) => setRaw((r) => ({ ...r, [m.id]: e.target.value }))}
                    placeholder="0"
                    className={m.unit ? "pr-20" : undefined}
                  />
                  {m.unit && (
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                      {m.unit}
                    </span>
                  )}
                </div>
              </FormField>
            );
          })}
        </CardContent>
      </Card>

      {calculated.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="size-4 text-primary" aria-hidden /> Calculated automatically
            </CardTitle>
            <CardDescription>Updates as you type. Shows — when a value cannot be calculated (for example 0 hours).</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-3" aria-live="polite">
              {calculated.map((m) => (
                <div key={m.id} className="rounded-lg border bg-muted/30 p-3">
                  <dt className="text-xs text-muted-foreground">{m.name}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {formatMetricValue(preview[m.id], m.data_type, m.unit)}
                  </dd>
                  {m.description && <dd className="text-xs text-muted-foreground">{m.description}</dd>}
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <SubmitButton
          pending={pending && activeIntent === "draft"}
          disabled={pending}
          onClick={() => setActiveIntent("draft")}
          name="intent"
          value="draft"
          variant="outline"
          className="h-10"
        >
          Save draft
        </SubmitButton>
        <SubmitButton
          pending={pending && activeIntent === "submit"}
          disabled={pending}
          onClick={() => setActiveIntent("submit")}
          pendingLabel="Saving…"
          name="intent"
          value="submit"
          className="h-10"
        >
          Submit for review
        </SubmitButton>
      </div>
    </form>
  );
}

function LockedEntry({ entry, metrics }: { entry: EntryWithValues; metrics: MetricDefinition[] }) {
  const [state, action, pending] = useActionState(withdrawEntry, initialFormState);
  const order = new Map(metrics.map((m) => [m.id, m.sort_order]));
  const values = [...entry.values].sort((a, b) => (order.get(a.metric_id) ?? 999) - (order.get(b.metric_id) ?? 999));
  const { title, description } = LOCKED_TEXT[entry.status === "rejected" ? "rejected" : entry.status === "pending" ? "pending" : "approved"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="size-4 text-muted-foreground" aria-hidden />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <FormMessage status={state.status} message={state.message} />
        {entry.review_note && entry.status !== "pending" && (
          <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
            <p className="text-xs font-medium text-muted-foreground">
              {entry.status === "rejected" ? "Reason from your administrator" : "Note from your administrator"}
            </p>
            <p className="mt-0.5 whitespace-pre-line">{entry.review_note}</p>
          </div>
        )}
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {values.map((v) => (
            <div key={v.id} className="flex items-baseline justify-between gap-4 border-b pb-2">
              <dt className="text-sm text-muted-foreground">{v.metric_name}</dt>
              <dd className="text-sm font-medium tabular-nums">{formatMetricValue(v.value, v.metric_data_type, v.metric_unit)}</dd>
            </div>
          ))}
        </dl>
        {entry.status === "pending" && (
          <form action={action}>
            <input type="hidden" name="entry_id" value={entry.id} />
            <SubmitButton pending={pending} pendingLabel="Withdrawing…" variant="outline">
              Withdraw to edit
            </SubmitButton>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

const LOCKED_TEXT = {
  pending: {
    title: "Submitted for review",
    description: "This entry is waiting for review. Withdraw it if you need to make a change.",
  },
  approved: {
    title: "Approved",
    description: "This entry has been verified and counts towards your performance. Ask an administrator if a correction is needed.",
  },
  rejected: {
    title: "Rejected",
    description: "This entry was rejected and does not count towards your performance. Contact your administrator if you think this is wrong.",
  },
};

function valueText(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}
