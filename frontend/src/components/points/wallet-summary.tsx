import { Gift, Hourglass, Star, Wallet } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { formatPoints } from "@/lib/points/schemas";
import type { PointsBalance } from "@/types/database";

/** Available / pending / lifetime / redeemed: the employee's wallet at a glance. */
export function WalletSummary({
  balance,
  pending,
}: {
  balance: Pick<PointsBalance, "available" | "held" | "lifetime_earned" | "redeemed">;
  pending: number;
}) {
  return (
    <section aria-label="Points wallet" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatCard
        label="Available"
        value={formatPoints(balance.available)}
        icon={Wallet}
        hint={balance.held > 0 ? `${formatPoints(balance.held)} reserved for requests` : "Ready to spend"}
      />
      <StatCard
        label="Pending"
        value={formatPoints(pending)}
        icon={Hourglass}
        hint="Credited once approved and the period ends"
        muted={pending === 0}
      />
      <StatCard label="Lifetime earned" value={formatPoints(balance.lifetime_earned)} icon={Star} muted={balance.lifetime_earned === 0} />
      <StatCard label="Redeemed" value={formatPoints(balance.redeemed)} icon={Gift} muted={balance.redeemed === 0} />
    </section>
  );
}
