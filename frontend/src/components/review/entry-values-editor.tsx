"use client";

import { Calculator, Pencil } from "lucide-react";
import { useActionState, useState } from "react";

import { editEntryValues } from "@/app/admin/submissions/actions";
import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { useConfirmSubmit } from "@/components/forms/use-confirm-submit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useFormValidation } from "@/hooks/use-form-validation";
import { valueEditConfirmation } from "@/lib/admin/confirmations";
import { initialFormState } from "@/lib/auth/validation";
import { entryValuesVersion, formatMetricValue, parseEntryValues } from "@/lib/metrics/values";
import type { EntryStatus, MetricDefinition, MetricEntryValue } from "@/types/database";

type Props = {
  entryId: string;
  status: EntryStatus;
  /** Input metrics an admin may correct (active, or already holding a value). */
  inputs: MetricDefinition[];
  values: MetricEntryValue[];
};

/** Submitted figures (as recorded, with the names at the time), with an admin correction form. */
export function EntryValuesEditor({ entryId, status, inputs, values }: Props) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(editEntryValues, initialFormState);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.status === "success") setEditing(false);
  }

  const inputIds = new Set(inputs.map((m) => m.id));
  const recordedInputs = values.filter((v) => inputIds.has(v.metric_id));
  const calculated = values.filter((v) => !inputIds.has(v.metric_id));

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Submitted figures</CardTitle>
          <CardDescription>
            {editing ? "Corrections are saved with your name and the old value in the audit trail." : "As recorded by the employee."}
          </CardDescription>
        </div>
        {!editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden /> Edit values
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {!editing && <FormMessage status={state.status} message={state.message} />}
        {editing ? (
          <EditForm entryId={entryId} status={status} inputs={inputs} values={values} state={state} action={action} pending={pending} onCancel={() => setEditing(false)} />
        ) : (
          <ValueList values={inputs.map((m) => recordedInputs.find((v) => v.metric_id === m.id)).filter((v) => v !== undefined)} />
        )}
        {calculated.length > 0 && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Calculator className="size-3.5" aria-hidden /> Calculated automatically
            </p>
            <ValueList values={calculated} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ValueList({ values }: { values: MetricEntryValue[] }) {
  if (values.length === 0) return <p className="text-sm text-muted-foreground">No values recorded.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {values.map((v) => (
        <div key={v.id} className="flex items-baseline justify-between gap-4 border-b pb-2">
          <dt className="text-sm text-muted-foreground">{v.metric_name}</dt>
          <dd className="text-sm font-medium tabular-nums">{formatMetricValue(v.value, v.metric_data_type, v.metric_unit)}</dd>
        </div>
      ))}
    </dl>
  );
}

function EditForm({
  entryId,
  status,
  inputs,
  values,
  state,
  action,
  pending,
  onCancel,
}: Props & {
  state: typeof initialFormState;
  action: (fd: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  const validate = (fd: FormData) => {
    const raw = Object.fromEntries(inputs.map((m) => [m.id, String(fd.get(m.id) ?? "")]));
    const { errors } = parseEntryValues(inputs, raw, { submitting: true });
    return Object.keys(errors).length ? errors : null;
  };
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);
  const confirm = useConfirmSubmit((fd) => valueEditConfirmation(status, inputs, values, fd));
  const initial = (id: string) => {
    const echoed = state.values?.[id];
    if (echoed !== undefined) return echoed;
    const v = values.find((x) => x.metric_id === id)?.value;
    return v === null || v === undefined ? "" : String(v);
  };

  return (
    <form action={action} {...formProps} onSubmit={confirm.wrap(formProps.onSubmit)} className="space-y-5">
      <input type="hidden" name="entry_id" value={entryId} />
      <input type="hidden" name="version" value={entryValuesVersion(values)} />
      {showServerMessage && <FormMessage status={state.status} message={state.message} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {inputs.map((m) => (
          <FormField key={m.id} id={m.id} label={`${m.name}${m.is_required ? " *" : ""}${m.is_active ? "" : " (disabled)"}`} error={errors[m.id]}>
            <div className="relative">
              <Input
                {...fieldA11y(m.id, errors[m.id])}
                name={m.id}
                inputMode={m.data_type === "integer" ? "numeric" : "decimal"}
                autoComplete="off"
                maxLength={16}
                defaultValue={initial(m.id)}
                className={m.unit ? "pr-20" : undefined}
              />
              {m.unit && (
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                  {m.unit}
                </span>
              )}
            </div>
          </FormField>
        ))}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save corrections
        </SubmitButton>
      </div>
      {confirm.dialog}
    </form>
  );
}
