import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { NewPasswordForm } from "@/components/auth/new-password-form";
import { FormMessage } from "@/components/forms/form-field";
import { getCurrentProfile } from "@/lib/auth/session";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const params = await searchParams;
  const welcome = Boolean(params.welcome);
  const profile = await getCurrentProfile();

  if (!profile) {
    return (
      <AuthShell title="Link expired" description="This password link is invalid or has expired.">
        <div className="space-y-5">
          <FormMessage status="error" message="Password links can only be used once and expire after a short time." />
          <Link href="/forgot-password" className={cn(buttonVariants(), "h-10 w-full")}>
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={welcome ? "Welcome! Set your password" : "Choose a new password"}
      description={
        <>
          Signed in as <span className="font-medium text-foreground">{profile.email}</span>
        </>
      }
    >
      <NewPasswordForm mode="reset" submitLabel={welcome ? "Set password & continue" : "Update password"} />
    </AuthShell>
  );
}
