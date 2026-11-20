"use client";

import "./globals.css";

/** Last resort: the root layout itself failed, so this renders its own document. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col items-center justify-center px-4 text-center font-sans">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          The application couldn&apos;t start. Please try again. If the problem continues, contact your administrator.
        </p>
        {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
        <button type="button" onClick={reset} className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Try again
        </button>
      </body>
    </html>
  );
}
