"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavVariant } from "./nav-config";
import { SidebarNav } from "./sidebar-nav";

export function MobileNav({
  variant,
  pendingApprovalsCount = 0,
}: {
  variant: NavVariant;
  pendingApprovalsCount?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation menu" />}>
        <div className="relative">
          <Menu className="size-5" />
          {pendingApprovalsCount > 0 && (
            <span className="absolute -top-1 -right-1 flex size-2.5 rounded-full bg-primary" />
          )}
        </div>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-sidebar p-0">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>
            <Logo />
          </SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto px-3 pb-6">
          <SidebarNav
            variant={variant}
            pendingApprovalsCount={pendingApprovalsCount}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
