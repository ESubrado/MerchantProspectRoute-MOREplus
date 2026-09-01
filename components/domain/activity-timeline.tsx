import { StatusPill } from "@/components/domain/status-pill";

type TimelineItem = {
  detail: string;
  status: string;
  time: string;
  tone: "info" | "success" | "warning" | "danger" | "teal";
  title: string;
};

export function ActivityTimeline({ items }: { items: readonly TimelineItem[] }) {
  return (
    <ol className="space-y-0">
      {items.map((item, index) => (
        <li className="relative grid grid-cols-[1.25rem_1fr] gap-3 pb-5 last:pb-0" key={`${item.title}-${item.time}`}>
          <span aria-hidden="true" className="relative flex justify-center">
            <span className="mt-1.5 size-2.5 rounded-full border-2 border-white bg-[var(--teal)] shadow-[0_0_0_1px_var(--teal)]" />
            {index < items.length - 1 ? <span className="absolute bottom-0 top-5 w-px bg-[var(--line)]" /> : null}
          </span>
          <div className="min-w-0 pb-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-[var(--ink)]">{item.title}</p>
              <StatusPill tone={item.tone}>{item.status}</StatusPill>
            </div>
            <p className="mt-1 text-sm leading-5 text-[var(--ink-muted)]">{item.detail}</p>
            <p className="mt-1.5 text-xs font-medium text-[var(--ink-muted)]">{item.time}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
