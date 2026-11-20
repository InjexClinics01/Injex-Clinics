"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Confirmation } from "@/lib/admin/confirmations";

type Submit = React.FormEventHandler<HTMLFormElement>;
type Pending = { confirmation: Confirmation; form: HTMLFormElement; submitter: HTMLElement | null };

/**
 * Ask before submitting an important change. Runs after the form's own validation:
 * if `getConfirmation` returns something, the submit is held and a popup explains
 * what will happen; confirming submits the form again with the same button.
 *
 *   const confirm = useConfirmSubmit((fd) => employeeConfirmation(employee, fd));
 *   <form action={action} {...formProps} onSubmit={confirm.wrap(formProps.onSubmit)}> … {confirm.dialog} </form>
 */
export function useConfirmSubmit(getConfirmation: (fd: FormData) => Confirmation | null) {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmed = useRef(false);

  const wrap =
    (validate?: Submit): Submit =>
    (event) => {
      validate?.(event);
      if (event.defaultPrevented) return;
      if (confirmed.current) {
        confirmed.current = false;
        return;
      }
      const form = event.currentTarget;
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const confirmation = getConfirmation(new FormData(form, submitter));
      if (!confirmation) return;
      event.preventDefault();
      setPending({ confirmation, form, submitter });
    };

  function proceed() {
    if (!pending) return;
    confirmed.current = true;
    setPending(null);
    pending.form.requestSubmit(pending.submitter);
  }

  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        {pending && (
          <>
            <DialogHeader>
              <DialogTitle>{pending.confirmation.title}</DialogTitle>
              <DialogDescription render={<div />}>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {pending.confirmation.details.map((line) => (
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Go back</DialogClose>
              <Button type="button" variant={pending.confirmation.destructive ? "destructive" : "default"} onClick={proceed}>
                {pending.confirmation.confirmLabel}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  return { wrap, dialog };
}
