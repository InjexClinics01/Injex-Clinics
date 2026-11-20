import { Coins, Gift, Hourglass, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { StatCard } from "@/components/dashboard/stat-card";
import { Pagination } from "@/components/dashboard/pagination";
import { LinkSelect } from "@/components/forms/link-select";
import { PageHeader } from "@/components/layout/page-header";
import { BalancesTable } from "@/components/points/balances-table";
import { TransactionList } from "@/components/points/transaction-list";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { parseEmployee } from "@/lib/performance/filters";
import { POINTS_KIND_LABELS, formatPoints } from "@/lib/points/schemas";
import { parsePage } from "@/lib/utils/fetch-page";
import { TRANSACTIONS_PAGE_SIZE, listBalances, listPendingPoints, listTransactions, syncPointsAfterResponse } from "@/services/points";
import type { PointsKind } from "@/types/database";

export const metadata: Metadata = { title: "Points" };

function hrefFor(employee: string | null, kind: PointsKind | null, page = 1) {
  const params = new URLSearchParams();
  if (employee) params.set("employee", employee);
  if (kind) params.set("kind", kind);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/admin/points${query ? `?${query}` : ""}`;
}

export default async function AdminPointsPage({ searchParams }: PageProps<"/admin/points">) {
  await requireAdmin();
  const params = await searchParams;
  const employee = parseEmployee(params);
  const kind = (Object.keys(POINTS_KIND_LABELS) as PointsKind[]).find((k) => k === params.kind) ?? null;

  await syncPointsAfterResponse();
  const [balances, pending, { rows, total, page }] = await Promise.all([
    listBalances(),
    listPendingPoints(),
    listTransactions({ employeeId: employee, kind, page: parsePage(params.page) }),
  ]);
  const pendingByEmployee: Record<string, number> = {};
  for (const a of pending) pendingByEmployee[a.employee_id] = (pendingByEmployee[a.employee_id] ?? 0) + a.points;
  const names = new Map(balances.map((b) => [b.employee_id, b.full_name]));
  const sum = (key: "lifetime_earned" | "available" | "redeemed") => balances.reduce((n, b) => n + b[key], 0);

  return (
    <>
      <PageHeader
        title="Points"
        description="Balances, the full points ledger and manual adjustments. Points are credited automatically from approved results."
        actions={
          <Link href="/admin/goals" className={buttonVariants({ variant: "outline" })}>
            Scoring rules
          </Link>
        }
      />
      <section aria-label="Points totals" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Total points awarded" value={formatPoints(sum("lifetime_earned"))} icon={Coins} hint="All time, net of corrections" />
        <StatCard label="Available in wallets" value={formatPoints(sum("available"))} icon={Wallet} />
        <StatCard
          label="Pending"
          value={formatPoints(Object.values(pendingByEmployee).reduce((n, v) => n + v, 0))}
          icon={Hourglass}
          hint="Not credited yet"
        />
        <StatCard label="Redeemed" value={formatPoints(sum("redeemed"))} icon={Gift} hint="All time" />
      </section>

      <h2 className="mt-8 mb-3 text-lg font-semibold">Balances</h2>
      <BalancesTable balances={balances} pending={pendingByEmployee} />

      <Card className="mt-8 pb-0">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Transactions</CardTitle>
            <CardDescription>
              {employee ? `For ${names.get(employee) ?? "one employee"}. ` : ""}The ledger is append-only: corrections are new transactions.
            </CardDescription>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <LinkSelect
              id="employee-filter"
              label="Employee"
              value={hrefFor(employee, kind)}
              options={[
                { href: hrefFor(null, kind), label: "Everyone" },
                ...balances.map((b) => ({ href: hrefFor(b.employee_id, kind), label: b.full_name })),
              ]}
            />
            <LinkSelect
              id="kind-filter"
              label="Type"
              value={hrefFor(employee, kind)}
              options={[
                { href: hrefFor(employee, null), label: "All types" },
                ...(Object.keys(POINTS_KIND_LABELS) as PointsKind[]).map((k) => ({ href: hrefFor(employee, k), label: POINTS_KIND_LABELS[k] })),
              ]}
            />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <TransactionList rows={rows} names={names} emptyText="No transactions match these filters." />
        </CardContent>
        <Pagination page={page} pageSize={TRANSACTIONS_PAGE_SIZE} total={total} hrefFor={(p) => hrefFor(employee, kind, p)} />
      </Card>
    </>
  );
}
