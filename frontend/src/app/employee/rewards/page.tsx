import type { Metadata } from "next";

import { Pagination } from "@/components/dashboard/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { MyRedemptions } from "@/components/points/my-redemptions";
import { RewardCatalogue } from "@/components/points/reward-catalogue";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireEmployee } from "@/lib/auth/session";
import { formatPoints } from "@/lib/points/schemas";
import { parsePage } from "@/lib/utils/fetch-page";
import { REDEMPTIONS_PAGE_SIZE, getBalance, listPendingRewardIds, listRedemptions, listRewards, syncPointsAfterResponse } from "@/services/points";

export const metadata: Metadata = { title: "Rewards" };

export default async function RewardsPage({ searchParams }: PageProps<"/employee/rewards">) {
  const profile = await requireEmployee();
  const requestedPage = parsePage((await searchParams).page);
  await syncPointsAfterResponse();
  const [balance, rewards, pendingRewardIds, { rows: redemptions, total, page }] = await Promise.all([
    getBalance(profile.id),
    listRewards(),
    listPendingRewardIds(profile.id),
    listRedemptions({ employeeId: profile.id, page: requestedPage }),
  ]);

  return (
    <>
      <PageHeader
        title="Rewards"
        description="Spend your points. Requests are approved by your administrator."
        actions={
          <Badge variant="secondary" className="h-8 px-3 text-sm tabular-nums">
            {formatPoints(balance.available)} points available
          </Badge>
        }
      />
      <RewardCatalogue
        rewards={rewards}
        available={balance.available}
        pendingRewardIds={pendingRewardIds}
      />
      <Card className="mt-6 pb-0">
        <CardHeader>
          <CardTitle>My requests</CardTitle>
          <CardDescription>Track each request from approval to hand-over.</CardDescription>
        </CardHeader>
        <CardContent>
          <MyRedemptions rows={redemptions} />
        </CardContent>
        <Pagination
          page={page}
          pageSize={REDEMPTIONS_PAGE_SIZE}
          total={total}
          hrefFor={(p) => (p > 1 ? `/employee/rewards?page=${p}` : "/employee/rewards")}
        />
      </Card>
    </>
  );
}
