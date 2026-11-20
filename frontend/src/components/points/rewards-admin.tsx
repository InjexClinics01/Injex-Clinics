"use client";

import { Gift, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPoints } from "@/lib/points/schemas";
import { cn } from "@/lib/utils";
import type { Reward } from "@/types/database";
import { RewardDialog } from "./reward-dialog";

/** Catalogue management: add, edit, set points and stock, deactivate. */
export function RewardsAdmin({ rewards }: { rewards: Reward[] }) {
  const [dialog, setDialog] = useState<{ open: boolean; reward?: Reward }>({ open: false });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Catalogue</CardTitle>
          <CardDescription>Stock is reduced automatically when a request is approved.</CardDescription>
        </div>
        <Button onClick={() => setDialog({ open: true })}>
          <Plus aria-hidden /> Add reward
        </Button>
      </CardHeader>
      <CardContent>
        {rewards.length === 0 ? (
          <EmptyState icon={Gift} title="No rewards yet" description="Add the first reward employees can spend their points on." className="py-8" />
        ) : (
          <ul className="divide-y">
            {rewards.map((r) => (
              <li key={r.id} className={cn("flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0", !r.is_active && "opacity-60")}>
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {r.name}
                    {!r.is_active && <Badge variant="outline">Inactive</Badge>}
                    {r.stock === 0 && r.is_active && (
                      <Badge variant="outline" className="border-warning/50 text-warning">
                        Out of stock
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatPoints(r.points_cost)} pts · {r.stock === null ? "unlimited stock" : `${r.stock} in stock`}
                  </p>
                  {r.description && <p className="line-clamp-2 text-xs text-muted-foreground">{r.description}</p>}
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ open: true, reward: r })} aria-label={`Edit ${r.name}`}>
                  <Pencil />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <RewardDialog open={dialog.open} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} reward={dialog.reward} />
    </Card>
  );
}
