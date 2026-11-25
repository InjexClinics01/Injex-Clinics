import type { Metadata } from "next";

import { EmployeesTabs } from "@/components/admin/employees-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { requireAdmin } from "@/lib/auth/session";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
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

      <EmployeesTabs
        initialTab={tab}
        profiles={profiles}
        categories={categories}
        currentUserId={admin.id}
        serviceRoleConfigured={isAdminClientConfigured()}
        pendingRequests={pendingRequests}
      />
    </>
  );
}
