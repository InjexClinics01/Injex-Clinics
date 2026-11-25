"use client";

import Link from "next/link";
import { useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";

export function SignupView() {
  const [isSuccess, setIsSuccess] = useState(false);

  return (
    <AuthShell
      title={isSuccess ? undefined : "Register as Employee"}
      description={isSuccess ? undefined : "Submit your details to request access as a Nurse or Beauty Therapist."}
      hideHeader={isSuccess}
      footer={
        isSuccess ? null : (
          <p>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        )
      }
    >
      <SignupForm onStatusChange={(status) => setIsSuccess(status === "success")} />
    </AuthShell>
  );
}
