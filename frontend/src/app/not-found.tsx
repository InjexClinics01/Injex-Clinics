import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Compass className="size-5" aria-hidden />
      </div>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link href="/dashboard" className={`${buttonVariants()} mt-6`}>
        Go to dashboard
      </Link>
    </main>
  );
}
