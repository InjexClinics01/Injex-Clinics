import { redirect } from "next/navigation";

import { homeForRole } from "@/lib/auth/routes";
import { requireUser } from "@/lib/auth/session";

/** Role-aware alias: /dashboard → /admin or /employee. */
export default async function DashboardRedirect() {
  const profile = await requireUser();
  redirect(homeForRole(profile.role));
}
