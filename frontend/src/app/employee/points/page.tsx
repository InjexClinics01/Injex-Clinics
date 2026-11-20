import { Gift } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Pagination } from "@/components/dashboard/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { PendingPointsList } from "@/components/points/pending-points-list";
import { TransactionList } from "@/components/points/transaction-list";
import { WalletSummary } from "@/components/points/wallet-summary";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireEmployee } from "@/lib/auth/session";
import { totalPendingPoints } from "@/lib/points/schemas";
import { parsePage } from "@/lib/utils/fetch-page";
import { TRANSACTIONS_PAGE_SIZE, getBalance, listPendingPoints, listTransactions, syncPointsAfterResponse } from "@/services/points";

export const metadata: Metadata = { title: "My Points" };

export default async function MyPointsPage({ searchParams }: PageProps<"/employee/points">) {
  const profile = await requireEmployee();
  const requestedPage = parsePage((await searchParams).page);

  await syncPointsAfterResponse();
  const [balance, pending, { rows, total, page }] = await Promise.all([
    getBalance(profile.id),
    listPendingPoints(),
    listTransactions({ employeeId: profile.id, page: requestedPage }),
  ]);

  return (
    <>
      <PageHeader
        title="My Points"
        description="Points are earned from approved results, goals and streaks, and credited once each day, week or month is complete."
        actions={
          <Link href="/employee/rewards" className={buttonVariants()}>
            <Gift aria-hidden /> Browse rewards
          </Link>
        }
      />
      <WalletSummary balance={balance} pending={totalPendingPoints(pending)} />

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="pb-0 lg:col-span-3">
          <CardHeader>
            <CardTitle>Transaction history</CardTitle>
            <CardDescription>Every point credited, corrected or spent. Nothing is ever changed or removed.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <TransactionList rows={rows} />
          </CardContent>
          <Pagination
            page={page}
            pageSize={TRANSACTIONS_PAGE_SIZE}
            total={total}
            hrefFor={(p) => (p > 1 ? `/employee/points?page=${p}` : "/employee/points")}
          />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pending points</CardTitle>
            <CardDescription>
              On track to be credited. Entries awaiting review are counted here; points are credited only if they are approved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PendingPointsList awards={pending} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
