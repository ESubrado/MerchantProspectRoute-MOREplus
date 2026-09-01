import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "teal";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-[var(--line)] bg-[var(--surface-subtle)] text-[var(--ink-muted)]",
  info: "border-[#caddec] bg-[var(--info-soft)] text-[var(--info)]",
  success: "border-[#cce4d6] bg-[var(--success-soft)] text-[var(--success)]",
  warning: "border-[#f0d5a6] bg-[var(--warning-soft)] text-[var(--warning)]",
  danger: "border-[#ecc7cf] bg-[var(--danger-soft)] text-[var(--danger)]",
  teal: "border-[#c3e0db] bg-[var(--teal-soft)] text-[var(--teal)]",
};

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap", toneClasses[tone])}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
