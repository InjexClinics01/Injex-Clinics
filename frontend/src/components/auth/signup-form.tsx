"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useFormValidation } from "@/hooks/use-form-validation";
import { registerEmployee } from "@/lib/auth/actions";
import { readSignup, signupSchema } from "@/lib/auth/signup-schema";
import { EMAIL_MAX_LENGTH, NAME_MAX_LENGTH, initialFormState, validator } from "@/lib/auth/validation";

const validate = validator(signupSchema, readSignup);

export function SignupForm() {
  const [state, action, pending] = useActionState(registerEmployee, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);

  if (state.status === "success") {
    return (
      <div className="space-y-6 text-center">
        <FormMessage status="success" message={state.message} />
        {/* <div className="rounded-lg border bg-muted/30 p-4 text-left text-sm text-muted-foreground">
          <p className="font-medium text-foreground">What happens next?</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>Your clinic administrator will review your registration request.</li>
            <li>Once approved, you will be able to sign in immediately with your email and password.</li>
          </ul>
        </div> */}
        <Link
          href="/login"
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Return to Sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} {...formProps} className="space-y-4">
      {state.message && showServerMessage && <FormMessage status={state.status} message={state.message} />}

      <FormField id="full_name" label="Full name" error={errors.full_name}>
        <Input
          {...fieldA11y("full_name", errors.full_name)}
          name="full_name"
          type="text"
          autoComplete="name"
          maxLength={NAME_MAX_LENGTH}
          placeholder="e.g. Sarah Jenkins"
          defaultValue={state.values?.full_name}
          required
          autoFocus
          className="h-10"
        />
      </FormField>

      <FormField id="email" label="Email address" error={errors.email}>
        <Input
          {...fieldA11y("email", errors.email)}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={EMAIL_MAX_LENGTH}
          placeholder="sarah@clinic.com"
          defaultValue={state.values?.email}
          required
          className="h-10"
        />
      </FormField>

      <FormField id="employee_category" label="Role / Category" error={errors.employee_category}>
        <NativeSelect
          {...fieldA11y("employee_category", errors.employee_category)}
          name="employee_category"
          defaultValue={state.values?.employee_category ?? ""}
          required
          className="h-10"
        >
          <option value="" disabled>Select your role…</option>
          <option value="nurse">Nurse</option>
          <option value="beauty_therapist">Beauty Therapist</option>
        </NativeSelect>
      </FormField>

      <FormField id="password" label="Create password" error={errors.password}>
        <PasswordInput
          {...fieldA11y("password", errors.password)}
          name="password"
          autoComplete="new-password"
          maxLength={128}
          placeholder="At least 8 characters"
          required
          className="h-10"
        />
      </FormField>

      <FormField id="confirm_password" label="Confirm password" error={errors.confirm_password}>
        <PasswordInput
          {...fieldA11y("confirm_password", errors.confirm_password)}
          name="confirm_password"
          autoComplete="new-password"
          maxLength={128}
          placeholder="Repeat password"
          required
          className="h-10"
        />
      </FormField>

      <SubmitButton pending={pending} pendingLabel="Submitting application…" className="h-10 w-full mt-2">
        Submit Registration
      </SubmitButton>
    </form>
  );
}
