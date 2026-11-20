import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/dashboard/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Not found" };

/** Shown inside the admin shell, e.g. for a submission or employee that doesn't exist. */
export default function AdminNotFound() {
  return (
    <Card>
      <EmptyState
        icon={SearchX}
        title="We couldn't find that"
        description="It may have been removed, or the link may be wrong."
        action={
          <Link href="/admin" className={buttonVariants()}>
            Back to overview
          </Link>
        }
      />
    </Card>
  );
}
