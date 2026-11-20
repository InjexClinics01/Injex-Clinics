"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { saveMetric } from "@/app/admin/goals/actions";
import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { useConfirmSubmit } from "@/components/forms/use-confirm-submit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useFormValidation } from "@/hooks/use-form-validation";
import { metricConfirmation } from "@/lib/admin/confirmations";
import { initialFormState, validator } from "@/lib/auth/validation";
import { metricSchema, readMetric } from "@/lib/metrics/schemas";
import type { MetricDefinition, MetricKind } from "@/types/database";

const validate = validator(metricSchema, readMetric);

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: string;
  /** Edit when provided, create otherwise. */
  metric?: MetricDefinition;
  /** Input metrics of this category (for calculated formulas). */
  inputMetrics: MetricDefinition[];
};

export function MetricFormDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        {props.open && <MetricForm key={props.metric?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function MetricForm({ onOpenChange, category, metric, inputMetrics }: Props) {
  const [state, action, pending] = useActionState(saveMetric, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);
  const confirm = useConfirmSubmit((fd) => metricConfirmation(metric, fd));
  const [kind, setKind] = useState<MetricKind>(metric?.kind ?? "input");
  const v = state.values ?? {};
  const text = (key: string, fallback: unknown) => v[key] ?? (fallback === null || fallback === undefined ? "" : String(fallback));
  const flag = (key: keyof MetricDefinition, fallback: boolean) => (v[key] !== undefined ? v[key] === "on" : (metric?.[key] as boolean) ?? fallback);
  const calculated = kind === "calculated";
  const numeratorDefault = metric?.numerator_is_unit_total ? "units" : (metric?.numerator_metric_id ?? "");

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onOpenChange(false);
    }
  }, [state, onOpenChange]);

  return (
    <form action={action} {...formProps} onSubmit={confirm.wrap(formProps.onSubmit)} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{metric ? "Edit metric" : "Add metric"}</DialogTitle>
        <DialogDescription>
          Changes apply to new entries. Past entries keep the values and names they were saved with.
        </DialogDescription>
      </DialogHeader>
      {showServerMessage && state.status === "error" && <FormMessage status="error" message={state.message} />}

      <input type="hidden" name="id" value={metric?.id ?? ""} />
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="kind" value={kind} />

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="name" label="Name" error={errors.name}>
          <Input {...fieldA11y("name", errors.name)} name="name" maxLength={80} defaultValue={text("name", metric?.name)} required />
        </FormField>
        <FormField id="kind_choice" label="Kind" hint={metric ? "Cannot be changed" : undefined}>
          <NativeSelect id="kind_choice" value={kind} onChange={(e) => setKind(e.target.value as MetricKind)} disabled={Boolean(metric)}>
            <option value="input">Entered by staff</option>
            <option value="calculated">Calculated (A ÷ B)</option>
          </NativeSelect>
        </FormField>
      </div>

      <FormField id="description" label="Description (optional)" error={errors.description}>
        <Input {...fieldA11y("description", errors.description)} name="description" maxLength={300} defaultValue={text("description", metric?.description)} />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="data_type" label="Value type" error={errors.data_type}>
          <NativeSelect {...fieldA11y("data_type", errors.data_type)} name="data_type" defaultValue={text("data_type", metric?.data_type ?? "decimal")}>
            <option value="integer">Whole number</option>
            <option value="decimal">Decimal number</option>
            <option value="currency">Money</option>
            <option value="percentage">Percentage (0–100)</option>
          </NativeSelect>
        </FormField>
        <FormField id="unit" label="Unit (optional)" error={errors.unit} hint="e.g. h, ml, treatments, $, $/h">
          <Input {...fieldA11y("unit", errors.unit, "hint")} name="unit" maxLength={20} defaultValue={text("unit", metric?.unit)} />
        </FormField>
      </div>

      {calculated ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="numerator" label="Divide (A)" error={errors.numerator}>
            <NativeSelect {...fieldA11y("numerator", errors.numerator)} name="numerator" defaultValue={text("numerator", numeratorDefault)}>
              <option value="">Choose…</option>
              <option value="units">Treatment units total</option>
              {inputMetrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="denominator_metric_id" label="By (B)" error={errors.denominator_metric_id}>
            <NativeSelect
              {...fieldA11y("denominator_metric_id", errors.denominator_metric_id)}
              name="denominator_metric_id"
              defaultValue={text("denominator_metric_id", metric?.denominator_metric_id)}
            >
              <option value="">Choose…</option>
              {inputMetrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-3">
          <FormField id="min_value" label="Minimum" error={errors.min_value}>
            <Input {...fieldA11y("min_value", errors.min_value)} name="min_value" inputMode="decimal" defaultValue={text("min_value", metric?.min_value ?? 0)} />
          </FormField>
          <FormField id="max_value" label="Maximum" error={errors.max_value}>
            <Input {...fieldA11y("max_value", errors.max_value)} name="max_value" inputMode="decimal" defaultValue={text("max_value", metric?.max_value)} placeholder="None" />
          </FormField>
          <FormField id="aggregation" label="Weekly / monthly total">
            <NativeSelect id="aggregation" name="aggregation" defaultValue={text("aggregation", metric?.aggregation ?? "sum")}>
              <option value="sum">Sum of days</option>
              <option value="average">Average of days</option>
            </NativeSelect>
          </FormField>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="default_target" label="Default daily target (optional)" error={errors.default_target}>
          <Input
            {...fieldA11y("default_target", errors.default_target)}
            name="default_target"
            inputMode="decimal"
            defaultValue={text("default_target", metric?.default_target)}
          />
        </FormField>
        <FormField id="sort_order" label="Display order" error={errors.sort_order}>
          <Input {...fieldA11y("sort_order", errors.sort_order)} name="sort_order" inputMode="numeric" defaultValue={text("sort_order", metric?.sort_order ?? 0)} />
        </FormField>
      </div>

      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Options</legend>
        {!calculated && <Check name="is_required" label="Required to submit" defaultChecked={flag("is_required", false)} />}
        {!calculated && <Check name="counts_as_unit" label="Counts as a treatment unit" defaultChecked={flag("counts_as_unit", false)} />}
        <Check name="is_goal_eligible" label="Can be used for goals" defaultChecked={flag("is_goal_eligible", false)} />
        <Check name="is_scoring_eligible" label="Can earn points" defaultChecked={flag("is_scoring_eligible", false)} />
        <Check name="is_active" label="Active (shown on the form)" defaultChecked={flag("is_active", true)} />
      </fieldset>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          {metric ? "Save changes" : "Add metric"}
        </SubmitButton>
      </DialogFooter>
      {confirm.dialog}
    </form>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-primary" />
      {label}
    </label>
  );
}
