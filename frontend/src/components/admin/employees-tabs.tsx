"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EmployeeCategory, EmployeeRegistrationRequest, Profile } from "@/types/database";
import { EmployeeDirectory } from "./employee-directory";
import { PendingRegistrations } from "./pending-registrations";

export function EmployeesTabs({
  initialTab = "directory",
  profiles,
  categories,
  currentUserId,
  serviceRoleConfigured,
  pendingRequests,
}: {
  initialTab?: "directory" | "pending";
  profiles: Profile[];
  categories: EmployeeCategory[];
  currentUserId: string;
  serviceRoleConfigured: boolean;
  pendingRequests: EmployeeRegistrationRequest[];
}) {
  const [tab, setTab] = useState<"directory" | "pending">(initialTab);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

  // Filter out any requests that have been resolved in this session
  const visibleRequests = pendingRequests.filter((r) => !resolvedIds.has(r.id));
  const pendingCount = visibleRequests.length;

  const handleRequestResolved = (id: string) => {
    setResolvedIds((prev) => new Set(prev).add(id));
  };

  const handleTabChange = (nextTab: "directory" | "pending") => {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === "pending") {
      url.searchParams.set("tab", "pending");
    } else {
      url.searchParams.delete("tab");
    }
    window.history.replaceState({}, "", url.toString());
  };

  return (
    <>
      <nav aria-label="Employee views" className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={() => handleTabChange("directory")}
          aria-current={tab === "directory" ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: tab === "directory" ? "secondary" : "ghost", size: "sm" }),
            "shrink-0 cursor-pointer",
            tab === "directory" && "font-semibold",
          )}
        >
          All Employees
          <Badge variant="outline" className="ml-2 font-normal">
            {profiles.length}
          </Badge>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("pending")}
          aria-current={tab === "pending" ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: tab === "pending" ? "secondary" : "ghost", size: "sm" }),
            "shrink-0 cursor-pointer",
            tab === "pending" && "font-semibold",
          )}
        >
          Pending Requests
          {pendingCount > 0 ? (
            <Badge className="ml-2 bg-primary font-bold text-primary-foreground">
              {pendingCount}
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-2 font-normal text-muted-foreground">
              0
            </Badge>
          )}
        </button>
      </nav>

      {tab === "pending" ? (
        <PendingRegistrations requests={visibleRequests} onResolved={handleRequestResolved} />
      ) : (
        <EmployeeDirectory
          profiles={profiles}
          categories={categories}
          currentUserId={currentUserId}
          serviceRoleConfigured={serviceRoleConfigured}
        />
      )}
    </>
  );
}
