import { redirect } from "next/navigation";

import { homeForRole } from "@/lib/auth/routes";
import { getCurrentProfile } from "@/lib/auth/session";

/** Entry point: send users to the dashboard for their role. */
export default async function Home() {
  const profile = await getCurrentProfile();
  redirect(profile?.is_active ? homeForRole(profile.role) : "/login");
}
