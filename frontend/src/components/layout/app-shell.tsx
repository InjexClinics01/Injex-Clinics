import Link from "next/link";
import { Suspense } from "react";

import { Logo } from "@/components/brand/logo";
import { MobileNav } from "@/components/navigation/mobile-nav";
import type { NavVariant } from "@/components/navigation/nav-config";
import { SidebarNav } from "@/components/navigation/sidebar-nav";
import { UserMenu } from "@/components/navigation/user-menu";
import { Badge } from "@/components/ui/badge";
import { categoryLabel, ROLE_LABELS } from "@/lib/constants";
import type { Profile } from "@/types/database";
import { ForbiddenNotice } from "./forbidden-notice";

/**
 * Authenticated layout: fixed sidebar on desktop (lg+), slide-out drawer on
 * tablet/mobile, sticky header with the user menu.
 */
export function AppShell({
  profile,
  children,
  pendingCount = 0,
}: {
  profile: Profile;
  children: React.ReactNode;
  pendingCount?: number;
}) {
  const variant: NavVariant = profile.role === "admin" ? "admin" : "employee";
  const home = variant === "admin" ? "/admin" : "/employee";
  const subtitle = profile.role === "admin" ? ROLE_LABELS.admin : categoryLabel(profile.employee_category);

  return (
    <div className="min-h-dvh bg-muted/30">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b px-5">
          <Link href={home} className="rounded-md focus-visible:outline-2 focus-visible:outline-ring">
            <Logo />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <SidebarNav variant={variant} pendingApprovalsCount={pendingCount} />
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
          <MobileNav variant={variant} pendingApprovalsCount={pendingCount} />
          <Link href={home} className="lg:hidden" aria-label="Home">
            <Logo showName={false} />
          </Link>
          <div className="flex-1" />
          {variant === "admin" && (
            <Badge variant="secondary" className="hidden sm:inline-flex">
              Admin
            </Badge>
          )}
          <UserMenu name={profile.full_name} email={profile.email} subtitle={subtitle} />
        </header>

        <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <Suspense fallback={null}>
            <ForbiddenNotice />
          </Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}
