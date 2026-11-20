"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

import { URL_ERROR_MESSAGES } from "@/lib/auth/errors";

/** Shows a toast when the proxy redirected here with ?error=forbidden, then cleans the URL. */
export function ForbiddenNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const error = params.get("error");

  useEffect(() => {
    if (error === "forbidden") {
      toast.error(URL_ERROR_MESSAGES.forbidden);
      router.replace(pathname);
    }
  }, [error, pathname, router]);

  return null;
}
