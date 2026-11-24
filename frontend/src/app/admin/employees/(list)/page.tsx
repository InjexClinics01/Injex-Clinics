import type { Metadata } from "next";
import Link from "next/link";

import { EmployeeDirectory } from "@/components/admin/employee-directory";
import { PendingRegistrations } from "@/components/admin/pending-registrations";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/session";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { listCategories, listProfiles } from "@/services/employees";
import { listPendingRegistrationRequests } from "@/services/registration";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage({ searchParams }: PageProps<"/admin/employees">) {
  const params = await searchParams;
  const tab = params?.tab === "pending" ? "pending" : "directory";

  const admin = await requireAdmin();
  const [allProfiles, categories, pendingRequests] = await Promise.all([
    listProfiles(),
    listCategories(),
    listPendingRegistrationRequests(),
  ]);

  // In the employee section, only show staff employees (not admin accounts)
  const profiles = allProfiles.filter((p) => p.role !== "admin");

  const pendingCount = pendingRequests.length;

  return (
    <>
      <PageHeader
        title="Employees"
        description={
          pendingCount > 0
            ? `Manage staff accounts. ${pendingCount} registration request${pendingCount === 1 ? " is" : "s are"} waiting for approval.`
            : "Manage staff accounts, roles and categories."
        }
      />

      <nav aria-label="Employee views" className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1">
        <Link
          href="/admin/employees"
          aria-current={tab === "directory" ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: tab === "directory" ? "secondary" : "ghost", size: "sm" }),
            "shrink-0",
            tab === "directory" && "font-semibold",
          )}
        >
          All Employees
          <Badge variant="outline" className="ml-2 font-normal">
            {profiles.length}
          </Badge>
        </Link>
        <Link
          href="/admin/employees?tab=pending"
          aria-current={tab === "pending" ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: tab === "pending" ? "secondary" : "ghost", size: "sm" }),
            "shrink-0",
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
        </Link>
      </nav>

      {tab === "pending" ? (
        <PendingRegistrations requests={pendingRequests} />
      ) : (
        <EmployeeDirectory
          profiles={profiles}
          categories={categories}
          currentUserId={admin.id}
          serviceRoleConfigured={isAdminClientConfigured()}
        />
      )}
    </>
  );
}
