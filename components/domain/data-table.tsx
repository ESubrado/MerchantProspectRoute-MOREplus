import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function DataTable({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_1px_2px_rgb(19_33_45/0.05)]", className)}>
      <div className="overflow-x-auto">
        <table aria-label={label} className="w-full min-w-[46rem] border-collapse text-left text-sm">{children}</table>
      </div>
    </div>
  );
}

export function TableHeader({ children }: { children: ReactNode }) {
  return <thead className="border-b border-[var(--line)] bg-[var(--surface-subtle)] text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">{children}</thead>;
}

export function TableHead({ children, className }: { children: ReactNode; className?: string }) {
  return <th className={cn("whitespace-nowrap px-4 py-3 font-bold", className)} scope="col">{children}</th>;
}

export function TableCell({ children, className, ...props }: ComponentProps<"td">) {
  return <td className={cn("whitespace-nowrap px-4 py-3.5 align-middle", className)} {...props}>{children}</td>;
}
