import { AppShell } from "@/components/layout/app-shell";
import { requireAdmin } from "@/lib/auth/session";
import { countPendingRegistrationRequests } from "@/services/registration";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const [profile, pendingCount] = await Promise.all([
    requireAdmin(),
    countPendingRegistrationRequests(),
  ]);
  return <AppShell profile={profile} pendingCount={pendingCount}>{children}</AppShell>;
}
