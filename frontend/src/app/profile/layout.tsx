import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";

/** Shared by admins and employees; the shell picks the matching navigation. */
export default async function ProfileLayout({ children }: LayoutProps<"/profile">) {
  const profile = await requireUser();
  return <AppShell profile={profile}>{children}</AppShell>;
}
