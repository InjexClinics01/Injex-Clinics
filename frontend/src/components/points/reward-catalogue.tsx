"use client";

import { Gift, PackageCheck } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { requestRedemption } from "@/app/employee/rewards/actions";
import { EmptyState } from "@/components/dashboard/empty-state";
import { FormMessage } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { initialFormState } from "@/lib/auth/validation";
import { formatPoints, redeemBlocker } from "@/lib/points/schemas";
import type { Reward } from "@/types/database";

/** Active rewards with what each costs and whether it can be requested now. */
export function RewardCatalogue({
  rewards,
  available,
  pendingRewardIds,
}: {
  rewards: Reward[];
  available: number;
  /** Rewards the employee already has a request waiting for. */
  pendingRewardIds: string[];
}) {
  const [selected, setSelected] = useState<Reward | null>(null);

  if (rewards.length === 0) {
    return (
      <Card>
        <EmptyState icon={Gift} title="No rewards yet" description="Your administrator hasn't added any rewards to the catalogue." />
      </Card>
    );
  }

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rewards.map((reward) => {
          const blocker = redeemBlocker(reward, available, pendingRewardIds.includes(reward.id));
          return (
            <li key={reward.id}>
              <Card className="h-full">
                <CardContent className="flex h-full flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-medium">{reward.name}</h3>
                    <Badge variant="secondary" className="shrink-0 tabular-nums">
                      {formatPoints(reward.points_cost)} pts
                    </Badge>
                  </div>
                  {reward.description && <p className="text-sm text-muted-foreground">{reward.description}</p>}
                  <p className="text-xs text-muted-foreground">
                    {reward.stock === null ? "Always available" : reward.stock > 0 ? `${reward.stock} left` : "Out of stock"}
                  </p>
                  <div className="mt-auto pt-1">
                    {blocker ? (
                      <p className="text-xs text-muted-foreground">{blocker}</p>
                    ) : (
                      <Button className="w-full" onClick={() => setSelected(reward)}>
                        <PackageCheck aria-hidden /> Redeem
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          {selected && <ConfirmRedeem key={selected.id} reward={selected} available={available} onDone={() => setSelected(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConfirmRedeem({ reward, available, onDone }: { reward: Reward; available: number; onDone: () => void }) {
  const [state, action, pending] = useActionState(requestRedemption, initialFormState);
  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={action} className="space-y-5">
      <DialogHeader>
        <DialogTitle>Redeem {reward.name}?</DialogTitle>
        <DialogDescription>
          {formatPoints(reward.points_cost)} points will be reserved now and deducted when an administrator approves your request.
          You will have {formatPoints(available - reward.points_cost)} points available.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="reward_id" value={reward.id} />
      {state.status === "error" && <FormMessage status="error" message={state.message} />}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Not now</DialogClose>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send request
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
