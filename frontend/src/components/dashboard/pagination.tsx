import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Previous / next links with a "1–20 of 57" summary. */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const link = (target: number, label: string, icon: React.ReactNode, disabled: boolean) =>
    disabled ? (
      <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")} aria-disabled>
        {icon} {label}
      </span>
    ) : (
      <Link href={hrefFor(target)} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {icon} {label}
      </Link>
    );

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
      <p className="text-muted-foreground" aria-live="polite">
        {first}–{last} of {total}
      </p>
      <div className="flex gap-2">
        {link(page - 1, "Previous", <ChevronLeft aria-hidden />, page <= 1)}
        {link(page + 1, "Next", <ChevronRight aria-hidden />, page >= pages)}
      </div>
    </nav>
  );
}
