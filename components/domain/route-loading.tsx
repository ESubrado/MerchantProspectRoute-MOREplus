import { LoadingIndicator } from "@/components/ui/loading-indicator";

type RouteLoadingProps = {
  description?: string;
  title?: string;
};

/** Provides an immediate, consistent fallback while an authenticated route streams its data. */
export function RouteLoading({
  description = "Retrieving the latest workspace information.",
  title = "Loading workspace",
}: RouteLoadingProps) {
  return (
    <section aria-busy="true" aria-live="polite" className="grid min-h-[28rem] place-items-center overflow-hidden rounded-xl border border-[var(--line)] bg-[linear-gradient(135deg,var(--surface)_0%,var(--surface)_57%,var(--primary-soft)_150%)] px-5 py-10 shadow-[0_1px_2px_rgb(19_33_45/0.05)]">
      <div className="w-full max-w-xl">
        <div className="mx-auto flex max-w-sm flex-col items-center text-center">
          <LoadingIndicator className="size-12 rounded-2xl bg-white shadow-[0_8px_20px_rgb(30_93_149/0.14)]" />
          <div className="mt-4">
            <p className="text-base font-semibold tracking-tight text-[var(--ink)]" role="status">{title}</p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{description}</p>
          </div>
        </div>
        <div aria-hidden="true" className="mt-9 grid gap-3 sm:grid-cols-3">
          <div className="route-loading-shimmer h-20 rounded-xl border border-[var(--line)] bg-white" />
          <div className="route-loading-shimmer h-20 rounded-xl border border-[var(--line)] bg-white [animation-delay:120ms]" />
          <div className="route-loading-shimmer h-20 rounded-xl border border-[var(--line)] bg-white [animation-delay:240ms]" />
        </div>
        <div aria-hidden="true" className="route-loading-shimmer mt-3 h-24 rounded-xl border border-[var(--line)] bg-white [animation-delay:180ms]" />
      </div>
    </section>
  );
}
