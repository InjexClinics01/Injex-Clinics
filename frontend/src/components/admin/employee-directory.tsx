"use client";

import { ChartLine, Pencil, Search, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { categoryLabel } from "@/lib/constants";
import { formatDate, initials } from "@/lib/utils/format";
import type { EmployeeCategory, Profile } from "@/types/database";
import { EmployeeFormDialog } from "./employee-form-dialog";

type Filters = { q: string; category: string; role: string; status: string };

export function EmployeeDirectory({
  profiles,
  categories,
  currentUserId,
  serviceRoleConfigured,
}: {
  profiles: Profile[];
  categories: EmployeeCategory[];
  currentUserId: string;
  serviceRoleConfigured: boolean;
}) {
  const [filters, setFilters] = useState<Filters>({ q: "", category: "all", role: "all", status: "all" });
  const [dialog, setDialog] = useState<{ open: boolean; employee?: Profile }>({ open: false });

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return profiles.filter((p) => {
      if (q && !`${p.full_name} ${p.email}`.toLowerCase().includes(q)) return false;
      if (filters.role !== "all" && p.role !== filters.role) return false;
      if (filters.status !== "all" && String(p.is_active) !== filters.status) return false;
      if (filters.category === "none" && p.employee_category) return false;
      if (filters.category !== "all" && filters.category !== "none" && p.employee_category !== filters.category) return false;
      return true;
    });
  }, [profiles, filters]);

  const set = (key: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [key]: e.target.value }));
  const hasFilters = filters.q || filters.category !== "all" || filters.role !== "all" || filters.status !== "all";

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            placeholder="Search by name or email"
            aria-label="Search employees"
            value={filters.q}
            onChange={set("q")}
            className="pl-8"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
          <div className="col-span-2 sm:col-span-1">
          <NativeSelect aria-label="Filter by category" value={filters.category} onChange={set("category")} className="lg:w-44">
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
            <option value="none">Unassigned</option>
          </NativeSelect>
          </div>
          <NativeSelect aria-label="Filter by role" value={filters.role} onChange={set("role")} className="lg:w-36">
            <option value="all">All roles</option>
            <option value="employee">Employees</option>
            <option value="admin">Admins</option>
          </NativeSelect>
          <NativeSelect aria-label="Filter by status" value={filters.status} onChange={set("status")} className="lg:w-36">
            <option value="all">Any status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </NativeSelect>
        </div>
        {/* Commented out: Manual employee creation by admin is disabled in favor of employee self-signup with admin approval */}
        {/*
        <Button onClick={() => setDialog({ open: true })} className="lg:ml-2">
          <UserPlus /> Add employee 
        </Button>
        */}
      </div>

      <Card className="py-0">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={hasFilters ? "No matching employees" : "No employees yet"}
            description={hasFilters ? "Try a different search or clear the filters." : "New employees can register at /signup, and their applications will appear in the Pending Requests tab."}
            action={
              hasFilters ? (
                <Button variant="outline" onClick={() => setFilters({ q: "", category: "all", role: "all", status: "all" })}>
                  Clear filters
                </Button>
              ) : undefined
              /*
              Commented out: Manual employee creation by admin is disabled in favor of employee self-signup with admin approval
              : (
                <Button onClick={() => setDialog({ open: true })}>
                  <UserPlus /> Add employee
                </Button>
              )
              */
            }
          />
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Added</TableHead>
                    <TableHead className="w-12 pr-4">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="pl-4">
                        <PersonCell profile={p} isSelf={p.id === currentUserId} />
                      </TableCell>
                      <TableCell>
                        <CategoryBadge slug={p.employee_category} role={p.role} />
                      </TableCell>
                      <TableCell className="capitalize">{p.role}</TableCell>
                      <TableCell>
                        <StatusBadge active={p.is_active} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(p.created_at)}</TableCell>
                      <TableCell className="pr-4 text-right whitespace-nowrap">
                        {p.role === "employee" && <PerformanceLink profile={p} />}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDialog({ open: true, employee: p })}
                          aria-label={`Edit ${p.full_name || p.email}`}
                        >
                          <Pencil />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y md:hidden">
              {filtered.map((p) => (
                <li key={p.id} className="flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <PersonCell profile={p} isSelf={p.id === currentUserId} />
                    <div className="flex flex-wrap gap-1.5 pl-11">
                      {(p.employee_category || p.role !== "admin") && <CategoryBadge slug={p.employee_category} role={p.role} />}
                      {p.role === "admin" && <Badge variant="secondary">Admin</Badge>}
                      <StatusBadge active={p.is_active} />
                    </div>
                  </div>
                  {p.role === "employee" && <PerformanceLink profile={p} />}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ open: true, employee: p })}
                    aria-label={`Edit ${p.full_name || p.email}`}
                  >
                    <Pencil /> Edit
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
        Showing {filtered.length} of {profiles.length} accounts
      </p>

      <EmployeeFormDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        employee={dialog.employee}
        categories={categories}
        currentUserId={currentUserId}
        serviceRoleConfigured={serviceRoleConfigured}
      />
    </>
  );
}

function PerformanceLink({ profile }: { profile: Profile }) {
  return (
    <Link
      href={`/admin/employees/${profile.id}`}
      className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
      aria-label={`Performance of ${profile.full_name || profile.email}`}
      title="Performance"
    >
      <ChartLine />
    </Link>
  );
}

function PersonCell({ profile, isSelf }: { profile: Profile; isSelf: boolean }) {
  const name = profile.full_name || profile.email;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-8">
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium">
          {profile.full_name || <span className="text-muted-foreground italic">No name</span>}
          {isSelf && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{profile.email}</p>
      </div>
    </div>
  );
}

function CategoryBadge({ slug, role }: { slug: string | null; role: Profile["role"] }) {
  if (!slug) {
    return role === "admin" ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <Badge variant="outline" className="border-warning/50 text-warning">
        Unassigned
      </Badge>
    );
  }
  return <Badge variant="outline">{categoryLabel(slug)}</Badge>;
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className="border-success/40 text-success">
      <span className="size-1.5 rounded-full bg-success" aria-hidden /> Active
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden /> Inactive
    </Badge>
  );
}
