"use client";

import { Check, UserCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { categoryLabel } from "@/lib/constants";
import { formatDate, initials } from "@/lib/utils/format";
import type { EmployeeRegistrationRequest } from "@/types/database";
import { approveRegistrationRequest, rejectRegistrationRequest } from "@/app/admin/employees/actions";

export function PendingRegistrations({ requests }: { requests: EmployeeRegistrationRequest[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionId, setActionId] = useState<string | null>(null);

  const handleApprove = (id: string) => {
    setActionId(id);
    startTransition(async () => {
      try {
        const result = await approveRegistrationRequest(id);
        if (result.status === "success") {
          toast.success(result.message);
          router.refresh();
        } else {
          toast.error(result.message || "Failed to approve registration.");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not approve registration.");
      } finally {
        setActionId(null);
      }
    });
  };

  const handleReject = (id: string, name: string) => {
    const reason = window.prompt(`Are you sure you want to reject the registration for ${name}? You may provide an optional reason:`);
    if (reason === null) return; // cancelled

    setActionId(id);
    startTransition(async () => {
      try {
        const result = await rejectRegistrationRequest(id, reason);
        if (result.status === "success") {
          toast.success(result.message);
          router.refresh();
        } else {
          toast.error(result.message || "Failed to reject registration.");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not reject registration.");
      } finally {
        setActionId(null);
      }
    });
  };

  if (requests.length === 0) {
    return (
      <Card className="py-8">
        <EmptyState
          icon={UserCheck}
          title="No pending registration requests"
          description="When prospective nurses or beauty therapists submit the registration form, their applications will appear here for your review and approval."
        />
      </Card>
    );
  }

  return (
    <Card className="py-0">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Applicant</TableHead>
              <TableHead>Requested Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Submitted</TableHead>
              <TableHead className="w-44 pr-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => {
              const working = isPending && actionId === r.id;
              return (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                          {initials(r.full_name || r.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.full_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{categoryLabel(r.employee_category)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-warning/50 text-warning">
                      <span className="size-1.5 rounded-full bg-warning" aria-hidden /> Pending
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {formatDate(r.created_at)}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-destructive/10"
                        disabled={working}
                        onClick={() => handleReject(r.id, r.full_name)}
                      >
                        <X className="mr-1 size-3.5" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={working}
                        onClick={() => handleApprove(r.id)}
                      >
                        <Check className="mr-1 size-3.5" />
                        {working ? "Approving…" : "Approve"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
