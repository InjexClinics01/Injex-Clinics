import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { URL_ERROR_MESSAGES } from "@/lib/auth/errors";
import { safeRedirectPath } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? URL_ERROR_MESSAGES[params.error] : undefined;
  const next = typeof params.next === "string" ? safeRedirectPath(params.next, "") || undefined : undefined;

  const notice = error
    ? { status: "error" as const, message: error }
    : params.signed_out
      ? { status: "success" as const, message: "You have been signed out." }
      : params.password_reset
        ? { status: "success" as const, message: "Password updated. Please sign in with your new password." }
        : undefined;

  return (
    <AuthShell
      title="Sign in"
      description="Use the email and password provided by your administrator."
      footer={
        <p>
          New team member?{" "}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Register as Employee
          </Link>
        </p>
      }
    >
      <LoginForm next={next} notice={notice} />
    </AuthShell>
  );
}
