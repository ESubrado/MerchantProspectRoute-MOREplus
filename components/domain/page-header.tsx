import type { ReactNode } from "react";

type PageHeaderProps = {
  actions?: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
};

export function PageHeader({ actions, description, eyebrow, title }: PageHeaderProps) {
  return (
    <header className="flex flex-col justify-between gap-5 border-b border-[var(--line)] pb-6 sm:flex-row sm:items-end">
      <div className="max-w-3xl">
        <p className="text-xs font-bold tracking-[0.14em] text-[var(--teal)] uppercase">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-[var(--ink)] sm:text-[2rem]">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
