import type { Metadata } from "next";

import { SignupView } from "@/components/auth/signup-view";

export const metadata: Metadata = { title: "Register as Employee" };

export default function SignupPage() {
  return <SignupView />;
}
