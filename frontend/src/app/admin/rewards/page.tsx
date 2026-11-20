import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { RedemptionQueue } from "@/components/points/redemption-queue";
import { RewardsAdmin } from "@/components/points/rewards-admin";
import { requireAdmin } from "@/lib/auth/session";
import { REDEMPTION_TABS, type RedemptionTab } from "@/lib/points/schemas";
import { parsePage } from "@/lib/utils/fetch-page";
import { REDEMPTIONS_PAGE_SIZE, countRedemptions, listRedemptions, listRewards } from "@/services/points";

export const metadata: Metadata = { title: "Rewards" };

export default async function AdminRewardsPage({ searchParams }: PageProps<"/admin/rewards">) {
  await requireAdmin();
  const params = await searchParams;
  const tab = (Object.keys(REDEMPTION_TABS) as RedemptionTab[]).find((t) => t === params.tab) ?? "pending";

  const [rewards, { rows, total, page }, pending, toHandOver] = await Promise.all([
    listRewards(),
    listRedemptions({ statuses: [...REDEMPTION_TABS[tab].statuses], page: parsePage(params.page) }),
    countRedemptions("pending"),
    countRedemptions("approved"),
  ]);

  return (
    <>
      <PageHeader
        title="Rewards"
        description={
          pending === 0
            ? "Manage the catalogue and redemption requests."
            : `${pending} redemption ${pending === 1 ? "request is" : "requests are"} waiting for approval.`
        }
      />
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <RedemptionQueue
            rows={rows}
            tab={tab}
            counts={{ pending, approved: toHandOver }}
            page={page}
            pageSize={REDEMPTIONS_PAGE_SIZE}
            total={total}
          />
        </div>
        <div className="xl:col-span-2">
          <RewardsAdmin rewards={rewards} />
        </div>
      </div>
    </>
  );
}
