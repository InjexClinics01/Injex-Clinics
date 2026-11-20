import { AppShell } from "@/components/layout/app-shell";
import { requireEmployee } from "@/lib/auth/session";

export default async function EmployeeLayout({ children }: LayoutProps<"/employee">) {
  const profile = await requireEmployee();
  return <AppShell profile={profile}>{children}</AppShell>;
}
