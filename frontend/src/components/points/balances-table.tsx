"use client";

import { Search, SlidersHorizontal, Wallet } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { adjustPoints } from "@/app/admin/points/actions";
import { EmptyState } from "@/components/dashboard/empty-state";
import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { useConfirmSubmit } from "@/components/forms/use-confirm-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useFormValidation } from "@/hooks/use-form-validation";
import { adjustmentConfirmation } from "@/lib/admin/confirmations";
import { initialFormState, validator } from "@/lib/auth/validation";
import { categoryLabel } from "@/lib/constants";
import { adjustmentSchema, formatPoints, readAdjustment } from "@/lib/points/schemas";
import type { PointsBalance } from "@/types/database";

const validate = validator(adjustmentSchema, readAdjustment);

/** Every employee's balance with search and a manual adjustment action. */
export function BalancesTable({ balances, pending }: { balances: PointsBalance[]; pending: Record<string, number> }) {
  const [q, setQ] = useState("");
  const [adjusting, setAdjusting] = useState<PointsBalance | null>(null);
  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    return balances.filter((b) => !text || b.full_name.toLowerCase().includes(text));
  }, [balances, q]);

  return (
    <>
      <div className="relative mb-3 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" aria-label="Search employees" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8" />
      </div>
      <Card className="py-0">
        {shown.length === 0 ? (
          <EmptyState icon={Wallet} title={q ? "No matching employees" : "No employees yet"} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Employee</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Reserved</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Pending</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Lifetime</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Redeemed</TableHead>
                  <TableHead className="w-12 pr-4">
                    <span className="sr-only">Adjust</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((b) => (
                  <TableRow key={b.employee_id}>
                    <TableCell className="pl-4">
                      <Link href={`/admin/points?employee=${b.employee_id}`} className="font-medium hover:underline">
                        {b.full_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {categoryLabel(b.employee_category)}
                        {!b.is_active && (
                          <Badge variant="outline" className="ml-2">
                            Inactive
                          </Badge>
                        )}
                      </p>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatPoints(b.available)}</TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">{formatPoints(b.held)}</TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
                      {formatPoints(pending[b.employee_id] ?? 0)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatPoints(b.lifetime_earned)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatPoints(b.redeemed)}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button variant="ghost" size="icon-sm" onClick={() => setAdjusting(b)} aria-label={`Adjust points for ${b.full_name}`} title="Adjust points">
                        <SlidersHorizontal />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <Dialog open={adjusting !== null} onOpenChange={(open) => !open && setAdjusting(null)}>
        <DialogContent className="sm:max-w-md">
          {adjusting && <AdjustForm key={adjusting.employee_id} balance={adjusting} onDone={() => setAdjusting(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AdjustForm({ balance, onDone }: { balance: PointsBalance; onDone: () => void }) {
  const [state, action, pending] = useActionState(adjustPoints, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);
  const confirm = useConfirmSubmit((fd) => adjustmentConfirmation(balance.full_name, fd));
  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={action} {...formProps} onSubmit={confirm.wrap(formProps.onSubmit)} className="space-y-5">
      <DialogHeader>
        <DialogTitle>Adjust points for {balance.full_name}</DialogTitle>
        <DialogDescription>
          Available now: {formatPoints(balance.available)}. Use a negative number to remove points. The reason is shown to the employee and
          recorded in the audit log.
        </DialogDescription>
      </DialogHeader>
      {showServerMessage && state.status === "error" && <FormMessage status="error" message={state.message} />}
      <input type="hidden" name="employee_id" value={balance.employee_id} />
      <FormField id="amount" label="Points" error={errors.amount} hint="e.g. 50 or -20">
        <Input {...fieldA11y("amount", errors.amount, "hint")} name="amount" inputMode="numeric" maxLength={8} defaultValue={state.values?.amount ?? ""} />
      </FormField>
      <FormField id="reason" label="Reason" error={errors.reason}>
        <Textarea {...fieldA11y("reason", errors.reason)} name="reason" rows={3} maxLength={300} defaultValue={state.values?.reason ?? ""} placeholder="e.g. Bonus for covering extra shifts" />
      </FormField>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Record adjustment
        </SubmitButton>
      </DialogFooter>
      {confirm.dialog}
    </form>
  );
}
