"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { saveReward } from "@/app/admin/rewards/actions";
import { FormField, FormMessage, fieldA11y } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { useConfirmSubmit } from "@/components/forms/use-confirm-submit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormValidation } from "@/hooks/use-form-validation";
import { rewardConfirmation } from "@/lib/admin/confirmations";
import { initialFormState, validator } from "@/lib/auth/validation";
import { readReward, rewardSchema } from "@/lib/points/schemas";
import type { Reward } from "@/types/database";

const validate = validator(rewardSchema, readReward);

type Props = { open: boolean; onOpenChange: (open: boolean) => void; reward?: Reward };

export function RewardDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        {props.open && <RewardForm key={props.reward?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function RewardForm({ onOpenChange, reward }: Props) {
  const [state, action, pending] = useActionState(saveReward, initialFormState);
  const { errors, showServerMessage, formProps } = useFormValidation(validate, state);
  const confirm = useConfirmSubmit((fd) => rewardConfirmation(reward, fd));
  const v = state.values ?? {};

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onOpenChange(false);
    }
  }, [state, onOpenChange]);

  return (
    <form action={action} {...formProps} onSubmit={confirm.wrap(formProps.onSubmit)} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{reward ? "Edit reward" : "Add reward"}</DialogTitle>
        <DialogDescription>
          Price changes apply to new requests only. Deactivate a reward to hide it; past redemptions are kept.
        </DialogDescription>
      </DialogHeader>
      {showServerMessage && state.status === "error" && <FormMessage status="error" message={state.message} />}
      <input type="hidden" name="id" value={reward?.id ?? ""} />

      <FormField id="name" label="Name" error={errors.name}>
        <Input {...fieldA11y("name", errors.name)} name="name" maxLength={80} defaultValue={v.name ?? reward?.name ?? ""} placeholder="e.g. Coffee voucher" />
      </FormField>
      <FormField id="description" label="Description (optional)" error={errors.description}>
        <Textarea
          {...fieldA11y("description", errors.description)}
          name="description"
          rows={3}
          maxLength={500}
          defaultValue={v.description ?? reward?.description ?? ""}
        />
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="points_cost" label="Points needed" error={errors.points_cost}>
          <Input
            {...fieldA11y("points_cost", errors.points_cost)}
            name="points_cost"
            inputMode="numeric"
            maxLength={9}
            defaultValue={v.points_cost ?? reward?.points_cost ?? ""}
            placeholder="e.g. 500"
          />
        </FormField>
        <FormField id="stock" label="Stock" error={errors.stock} hint="Empty = unlimited">
          <Input
            {...fieldA11y("stock", errors.stock, "hint")}
            name="stock"
            inputMode="numeric"
            maxLength={9}
            defaultValue={v.stock ?? (reward?.stock ?? "")}
          />
        </FormField>
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={v.is_active !== undefined ? v.is_active === "on" : (reward?.is_active ?? true)}
          className="size-4 accent-primary"
        />
        Available to employees
      </label>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          {reward ? "Save changes" : "Add reward"}
        </SubmitButton>
      </DialogFooter>
      {confirm.dialog}
    </form>
  );
}
