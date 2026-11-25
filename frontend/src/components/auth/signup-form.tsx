"use client";

import { ArrowRight, Check, Clock } from "lucide-react";
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

export function SignupForm({ onStatusChange }: { onStatusChange?: (status: string) => void }) {
  const [state, action, pending] = useActionState(registerEmployee, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);

  if (state.status === "success") {
    onStatusChange?.("success");
    return (
      <div className="flex flex-col items-center text-center py-2">
        {/* Circular Success Check Icon matching reference image */}
        <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-emerald-50/80 text-emerald-600">
          <div className="flex size-8 items-center justify-center rounded-full border-2 border-emerald-600">
            <Check className="size-4.5 stroke-[2.5]" />
          </div>
        </div>

        {/* Title & Message */}
        <h2 className="text-xl font-bold tracking-tight text-foreground">Registration submitted!</h2>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-[290px]">
          Your registration request has been successfully submitted.
        </p>

        {/* Pending Approval Badge */}
        <div className="mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
          <Clock className="size-3.5 text-amber-600" />
          <span>Pending approval</span>
        </div>

        {/* Divider */}
        <div className="my-6 h-px w-full bg-border/80" />

        {/* What's next section */}
        <div className="space-y-2">
          <h3 className="text-base font-bold text-foreground">What&apos;s next?</h3>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-[270px]">
            Your clinic administrator will review your request. Once approved, you will receive an email notification with your confirmation to sign in.
          </p>
        </div>

        {/* Return to sign in button matching reference style */}
        <Link
          href="/login"
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Return to sign in <ArrowRight className="size-4" />
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
