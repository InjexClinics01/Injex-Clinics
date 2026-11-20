import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = { title: "Register as Employee" };

export default function SignupPage() {
  return (
    <AuthShell
      title="Register as Employee"
      description="Submit your details to request access as a Nurse or Beauty Therapist."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
