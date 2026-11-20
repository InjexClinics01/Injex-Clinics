"use client";

import { useActionState } from "react";

import { savePointsSettings } from "@/app/admin/settings/actions";
import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { useConfirmSubmit } from "@/components/forms/use-confirm-submit";
import { Input } from "@/components/ui/input";
import { useFormValidation } from "@/hooks/use-form-validation";
import { pointsSettingsConfirmation } from "@/lib/admin/confirmations";
import { initialFormState, validator } from "@/lib/auth/validation";
import { pointsSettingsSchema, readPointsSettings } from "@/lib/points/schemas";
import type { AppSettings } from "@/types/database";

const validate = validator(pointsSettingsSchema, readPointsSettings);

export function PointsSettingsForm({ settings }: { settings: AppSettings }) {
  const [state, action, pending] = useActionState(savePointsSettings, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);
  const confirm = useConfirmSubmit((fd) => pointsSettingsConfirmation(settings, fd));
  const v = state.values ?? {};

  return (
    <form action={action} {...formProps} onSubmit={confirm.wrap(formProps.onSubmit)} className="space-y-5">
      {showServerMessage && <FormMessage status={state.status} message={state.message} />}
      <FormField
        id="points_start_date"
        label="Points start date"
        error={errors.points_start_date}
        hint="Days, weeks and months ending before this date never earn points."
      >
        <Input
          {...fieldA11y("points_start_date", errors.points_start_date, "hint")}
          type="date"
          name="points_start_date"
          defaultValue={v.points_start_date ?? settings.points_start_date}
          className="w-full sm:w-48"
        />
      </FormField>

      <fieldset className="space-y-4 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Consistency streak</legend>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            name="streak_enabled"
            defaultChecked={v.streak_enabled !== undefined ? v.streak_enabled === "on" : settings.streak_enabled}
            className="size-4 accent-primary"
          />
          Award a bonus for consistent weeks
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="streak_min_days" label="Approved days a week" error={errors.streak_min_days}>
            <Input {...fieldA11y("streak_min_days", errors.streak_min_days)} name="streak_min_days" inputMode="numeric" maxLength={1} defaultValue={v.streak_min_days ?? settings.streak_min_days} />
          </FormField>
          <FormField id="streak_weeks" label="Weeks in a row" error={errors.streak_weeks}>
            <Input {...fieldA11y("streak_weeks", errors.streak_weeks)} name="streak_weeks" inputMode="numeric" maxLength={2} defaultValue={v.streak_weeks ?? settings.streak_weeks} />
          </FormField>
          <FormField id="streak_points" label="Bonus points" error={errors.streak_points}>
            <Input {...fieldA11y("streak_points", errors.streak_points)} name="streak_points" inputMode="numeric" maxLength={6} defaultValue={v.streak_points ?? settings.streak_points} />
          </FormField>
        </div>
        <p className="text-xs text-muted-foreground">
          Example: 4 days, 4 weeks, 100 points = 100 bonus points every 4th week in a row with at least 4 approved days.
        </p>
      </fieldset>

      <SubmitButton pending={pending} pendingLabel="Saving…" variant="outline">
        Save points settings
      </SubmitButton>
      {confirm.dialog}
    </form>
  );
}
