"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Sleek global top loading bar that gives instant visual feedback
 * whenever a link or tab is clicked, eliminating any perceived lag.
 */
export function NavigationProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // When the route or search params finish updating, hide the loading bar
    setLoading(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    // Intercept clicks on links to start the progress bar immediately
    const handleClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;

      const href = target.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || target.target === "_blank") {
        return;
      }

      // Check if it is an internal link that changes path or search
      const currentUrl = window.location.pathname + window.location.search;
      const targetUrl = new URL(target.href, window.location.href);
      const targetPath = targetUrl.pathname + targetUrl.search;

      if (targetUrl.origin === window.location.origin && targetPath !== currentUrl) {
        setLoading(true);
      }
    };

    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, []);

  if (!loading) return null;

  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="fixed top-0 left-0 right-0 z-[9999] h-0.5 overflow-hidden bg-primary/20"
    >
      <div className="h-full bg-primary animate-progress-indeterminate origin-left" />
    </div>
  );
}
