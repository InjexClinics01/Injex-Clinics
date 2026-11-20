"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

/** A labelled select whose options are URLs: choosing one navigates there. */
export function LinkSelect({
  id,
  label,
  value,
  options,
  className,
}: {
  id: string;
  label: string;
  value: string;
  options: { href: string; label: string }[];
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5">
        {label}
      </Label>
      <NativeSelect
        id={id}
        value={value}
        aria-busy={pending}
        onChange={(e) => startTransition(() => router.push(e.target.value))}
        className={pending ? "opacity-60" : undefined}
      >
        {options.map((o) => (
          <option key={o.href} value={o.href}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
