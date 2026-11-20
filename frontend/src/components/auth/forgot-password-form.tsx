"use client";

import { useActionState } from "react";

import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { useFormValidation } from "@/hooks/use-form-validation";
import { requestPasswordReset } from "@/lib/auth/actions";
import {
  EMAIL_MAX_LENGTH,
  forgotPasswordSchema,
  initialFormState,
  readForgotPassword,
  validator,
} from "@/lib/auth/validation";

const validate = validator(forgotPasswordSchema, readForgotPassword);

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);

  if (state.status === "success") {
    return <FormMessage status="success" message={state.message} />;
  }

  return (
    <form action={action} {...formProps} className="space-y-5">
      {showServerMessage && <FormMessage status={state.status} message={state.message} />}
      <FormField id="email" label="Email" error={errors.email}>
        <Input
          {...fieldA11y("email", errors.email)}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={EMAIL_MAX_LENGTH}
          placeholder="you@clinic.com"
          defaultValue={state.values?.email}
          required
          autoFocus
          className="h-10"
        />
      </FormField>
      <SubmitButton pending={pending} pendingLabel="Sending…" className="h-10 w-full">
        Send reset link
      </SubmitButton>
    </form>
  );
}
