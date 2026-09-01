import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--surface-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-muted)]",
        className,
      )}
      {...props}
    />
  );
}
