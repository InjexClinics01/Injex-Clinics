"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { useFormValidation } from "@/hooks/use-form-validation";
import { signIn } from "@/lib/auth/actions";
import { EMAIL_MAX_LENGTH, initialFormState, loginSchema, readLogin, validator } from "@/lib/auth/validation";

const validate = validator(loginSchema, readLogin);

export function LoginForm({ next, notice }: { next?: string; notice?: { status: "error" | "success"; message: string } }) {
  const [state, action, pending] = useActionState(signIn, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);
  const banner = state.status === "idle" ? notice : state;

  return (
    <form action={action} {...formProps} className="space-y-5">
      {banner && showServerMessage && <FormMessage status={banner.status} message={banner.message} />}
      {next && <input type="hidden" name="next" value={next} />}

      <FormField id="email" label="Email" error={errors.email}>
        <Input
          {...fieldA11y("email", errors.email)}
          name="email"
          type="email"
          autoComplete="username"
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

      <FormField
        id="password"
        label="Password"
        error={errors.password}
        labelAside={
          <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        }
      >
        <PasswordInput
          {...fieldA11y("password", errors.password)}
          name="password"
          autoComplete="current-password"
          maxLength={128}
          required
          className="h-10"
        />
      </FormField>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm select-none">
        <input
          type="checkbox"
          name="remember"
          defaultChecked
          className="size-4 rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-ring"
        />
        Keep me signed in on this device
      </label>

      <SubmitButton pending={pending} pendingLabel="Signing in…" className="h-10 w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}
