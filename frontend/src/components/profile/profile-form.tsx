"use client";

import { useActionState } from "react";

import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { useFormValidation } from "@/hooks/use-form-validation";
import { NAME_MAX_LENGTH, initialFormState, profileSchema, readProfile, validator } from "@/lib/auth/validation";
import { updateOwnProfile } from "@/lib/profile/actions";

const validate = validator(profileSchema, readProfile);

export function ProfileForm({ fullName }: { fullName: string }) {
  const [state, action, pending] = useActionState(updateOwnProfile, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);
  return (
    <form action={action} {...formProps} className="space-y-5">
      {showServerMessage && <FormMessage status={state.status} message={state.message} />}
      <FormField id="full_name" label="Full name" error={errors.full_name}>
        <Input
          {...fieldA11y("full_name", errors.full_name)}
          name="full_name"
          defaultValue={state.values?.full_name ?? fullName}
          autoComplete="name"
          maxLength={NAME_MAX_LENGTH}
          required
        />
      </FormField>
      <SubmitButton pending={pending} pendingLabel="Saving…">
        Save changes
      </SubmitButton>
    </form>
  );
}
