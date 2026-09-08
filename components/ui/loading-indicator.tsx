import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** A compact motion-safe progress mark for route and in-place loading states. */
export function LoadingIndicator({ className, ...props }: ComponentProps<"span">) {
  return (
    <span aria-hidden="true" className={cn("relative grid size-10 shrink-0 place-items-center text-[var(--primary)]", className)} {...props}>
      <span className="route-loading-ring absolute inset-1 rounded-full border-2 border-current border-r-transparent" />
      <span className="route-loading-core size-1.5 rounded-full bg-current" />
    </span>
  );
}
