import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-lg border border-[var(--line-strong)] bg-white px-3 py-2 text-sm text-[var(--ink)] shadow-[0_1px_1px_rgb(19_33_45/0.03)] placeholder:text-[var(--ink-muted)] focus-visible:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-soft)] disabled:cursor-not-allowed disabled:bg-[var(--surface-subtle)]",
        className,
      )}
      {...props}
    />
  );
}
