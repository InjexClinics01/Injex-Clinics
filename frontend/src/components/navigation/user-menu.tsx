"use client";

import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth/actions";
import { initials } from "@/lib/utils/format";

export function UserMenu({ name, email, subtitle }: { name: string; email: string; subtitle: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const displayName = name || email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2.5 rounded-lg p-1 pr-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Account menu for ${displayName}`}
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials(displayName)}</AvatarFallback>
        </Avatar>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-40 truncate text-sm font-medium leading-tight">{displayName}</span>
          <span className="block max-w-40 truncate text-xs text-muted-foreground">{subtitle}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-medium text-foreground">{displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          <UserRound /> My profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={pending} onClick={() => startTransition(() => signOut())}>
          <LogOut /> {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
