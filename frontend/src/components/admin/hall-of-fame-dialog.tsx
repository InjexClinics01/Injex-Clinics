"use client";

import { Award, Sparkles } from "lucide-react";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { createHallOfFameAward, updateHallOfFameAward } from "@/app/admin/leaderboard/actions";
import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormValidation } from "@/hooks/use-form-validation";
import { initialFormState, validator } from "@/lib/auth/validation";
import { categoryLabel } from "@/lib/constants";
import { hallOfFameSchema, readHallOfFame } from "@/lib/hall-of-fame/schemas";
import type { HallOfFameAward, Profile } from "@/types/database";

const validate = validator(hallOfFameSchema, readHallOfFame);

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Pick<Profile, "id" | "full_name" | "employee_category">[];
  suggestedEmployeeId?: string | null;
  suggestedPeriod?: string;
  suggestedTitle?: string;
  initialData?: HallOfFameAward | null;
};

export function HallOfFameDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        {props.open && <HallOfFameForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function HallOfFameForm({
  onOpenChange,
  employees,
  suggestedEmployeeId,
  suggestedPeriod,
  suggestedTitle,
  initialData,
}: Props) {
  const isEditing = Boolean(initialData);

  const boundAction = isEditing && initialData
    ? updateHallOfFameAward.bind(null, initialData.id)
    : createHallOfFameAward;

  const [state, action, pending] = useActionState(boundAction, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);
  const v = state.values ?? {};

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onOpenChange(false);
    }
  }, [state, onOpenChange]);

  return (
    <form action={action} {...formProps} className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Award className="size-5 text-amber-500" aria-hidden />
          {isEditing ? "Edit Hall of Fame Award" : "Induct into Hall of Fame"}
        </DialogTitle>
        <DialogDescription>
          {isEditing
            ? "Update the details, citation, or bonus points for this Hall of Fame recognition."
            : "Recognise an outstanding employee (e.g. Employee of the Month) with a public citation and optional bonus points. Inducting a staff member sets them as the current Hall of Fame star."}
        </DialogDescription>
      </DialogHeader>

      {state.status === "error" && showServerMessage && (
        <FormMessage status="error" message={state.message} />
      )}

      <FormField id="employee_id" label="Employee" error={errors.employee_id}>
        <NativeSelect
          {...fieldA11y("employee_id", errors.employee_id)}
          name="employee_id"
          defaultValue={v.employee_id ?? initialData?.employee_id ?? suggestedEmployeeId ?? ""}
          required
        >
          <option value="">Select an employee…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name} {e.employee_category ? `(${categoryLabel(e.employee_category)})` : ""}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="title" label="Award title" error={errors.title}>
          <Input
            {...fieldA11y("title", errors.title)}
            name="title"
            placeholder="e.g. Employee of the Month"
            defaultValue={v.title ?? initialData?.title ?? suggestedTitle ?? "Employee of the Month"}
            required
            maxLength={100}
          />
        </FormField>

        <FormField id="award_period" label="Period" error={errors.award_period}>
          <Input
            {...fieldA11y("award_period", errors.award_period)}
            name="award_period"
            placeholder="e.g. May 2026"
            defaultValue={v.award_period ?? initialData?.award_period ?? suggestedPeriod ?? ""}
            required
            maxLength={50}
          />
        </FormField>
      </div>

      <FormField
        id="citation"
        label="Reason / Citation message"
        error={errors.citation}
        hint="Describe why they earned this award (shown publicly on the leaderboard)."
      >
        <Textarea
          {...fieldA11y("citation", errors.citation, "hint")}
          name="citation"
          rows={3}
          placeholder="e.g. Awarded for achieving 95% rebooking, exceptional teamwork, and outstanding client reviews throughout the month."
          defaultValue={v.citation ?? initialData?.citation ?? ""}
          required
          maxLength={500}
        />
      </FormField>

      <FormField
        id="bonus_points"
        label="Bonus points"
        error={errors.bonus_points}
        hint="Optional reward points to credit immediately to their wallet (enter 0 for none)."
      >
        <div className="relative">
          <Input
            {...fieldA11y("bonus_points", errors.bonus_points, "hint")}
            name="bonus_points"
            type="number"
            min={0}
            max={100000}
            defaultValue={v.bonus_points ?? initialData?.bonus_points ?? 0}
            className="pl-8"
          />
          <Sparkles className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        </div>
      </FormField>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <SubmitButton
          pending={pending}
          pendingLabel={isEditing ? "Saving…" : "Awarding…"}
        >
          {isEditing ? "Save Changes" : "Award & Induct"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
