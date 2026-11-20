"use client";

import { useActionState, useEffect, useRef } from "react";

import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { SubmitButton } from "@/components/forms/submit-button";
import { useFormValidation } from "@/hooks/use-form-validation";
import { changePassword, resetPassword } from "@/lib/auth/actions";
import {
  PASSWORD_MIN_LENGTH,
  changePasswordSchema,
  initialFormState,
  newPasswordSchema,
  readChangePassword,
  readNewPassword,
  validator,
} from "@/lib/auth/validation";

const validateReset = validator(newPasswordSchema, readNewPassword);
const validateChange = validator(changePasswordSchema, readChangePassword);
const HINT = `At least ${PASSWORD_MIN_LENGTH} characters, including a letter and a number.`;

/**
 * - mode "reset":  /reset-password after an emailed recovery/invite link (redirects when done)
 * - mode "change": profile page; requires the current password
 */
export function NewPasswordForm({ mode, submitLabel = "Update password" }: { mode: "reset" | "change"; submitLabel?: string }) {
  const isChange = mode === "change";
  const [state, action, pending] = useActionState(isChange ? changePassword : resetPassword, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(isChange ? validateChange : validateReset, state);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} {...formProps} className="space-y-5">
      {showServerMessage && <FormMessage status={state.status} message={state.message} />}
      {isChange && (
        <FormField id="currentPassword" label="Current password" error={errors.currentPassword}>
          <PasswordInput
            {...fieldA11y("currentPassword", errors.currentPassword)}
            name="currentPassword"
            autoComplete="current-password"
            maxLength={128}
            required
            className="h-10"
          />
        </FormField>
      )}
      <FormField id="password" label="New password" error={errors.password} hint={HINT}>
        <PasswordInput
          {...fieldA11y("password", errors.password, HINT)}
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={72}
          required
          className="h-10"
        />
      </FormField>
      <FormField id="confirmPassword" label="Confirm new password" error={errors.confirmPassword}>
        <PasswordInput
          {...fieldA11y("confirmPassword", errors.confirmPassword)}
          name="confirmPassword"
          autoComplete="new-password"
          maxLength={72}
          required
          className="h-10"
        />
      </FormField>
      <SubmitButton pending={pending} pendingLabel="Saving…" className="h-10 w-full sm:w-auto">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
