"use client";

import { useState } from "react";

import type { FieldErrors, FormState } from "@/lib/auth/validation";

/**
 * Instant client-side validation for <form action={serverAction}> forms.
 *
 * - On submit, runs `validate`. If it fails, the submission is cancelled
 *   (React does not call the action when the submit event is prevented) and
 *   the errors are shown without a server round-trip.
 * - Editing a field clears that field's client error.
 * - When the server responds, its result replaces the client errors. The
 *   server always re-validates; this hook is for user experience only.
 */
export function useFormValidation(validate: (fd: FormData) => FieldErrors | null, serverState: FormState) {
  const [clientErrors, setClientErrors] = useState<FieldErrors | null>(null);
  const [seenState, setSeenState] = useState(serverState);

  if (serverState !== seenState) {
    setSeenState(serverState);
    setClientErrors(null);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Include the clicked button's name/value (e.g. intent=submit vs intent=draft).
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const errors = validate(new FormData(event.currentTarget, submitter));
    if (errors) {
      event.preventDefault();
      setClientErrors(errors);
      const first = Object.keys(errors)[0];
      event.currentTarget.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    } else {
      setClientErrors(null);
    }
  }

  function onChange(event: React.FormEvent<HTMLFormElement>) {
    const name = (event.target as HTMLInputElement).name;
    if (clientErrors?.[name]) {
      setClientErrors((prev) => {
        if (!prev) return prev;
        const rest = { ...prev };
        delete rest[name];
        return rest;
      });
    }
  }

  const showingClient = clientErrors !== null;
  return {
    errors: (showingClient ? clientErrors : serverState.fieldErrors) ?? {},
    /** Hide a stale server banner while client errors are shown. */
    showServerMessage: !showingClient,
    formProps: { onSubmit, onChange, noValidate: true },
  };
}
