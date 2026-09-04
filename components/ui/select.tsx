import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Applies the shared input treatment to native selects without hiding their accessible platform behavior. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-lg border border-[var(--line-strong)] bg-white px-3 text-sm text-[var(--ink)] shadow-[0_1px_1px_rgb(19_33_45/0.03)] focus-visible:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-soft)] disabled:cursor-not-allowed disabled:bg-[var(--surface-subtle)]",
        className,
      )}
      {...props}
    />
  );
}
