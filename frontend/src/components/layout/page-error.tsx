"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button, buttonVariants } from "@/components/ui/button";

/** Shared body of the error boundaries (app/error.tsx and the section-level ones). */
export function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        We couldn&apos;t load this page. Please try again. If the problem continues, contact your administrator.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>
          <RotateCcw /> Try again
        </Button>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
