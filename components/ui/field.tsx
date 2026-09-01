import type { ReactNode } from "react";

export function Field({ children, hint, label }: { children: ReactNode; hint?: string; label: string }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal leading-5 text-[var(--ink-muted)]">{hint}</span> : null}
    </label>
  );
}
