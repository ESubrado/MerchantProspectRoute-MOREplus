"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SearchIcon, SlidersIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type FilterOption = { label: string; value: string };

type FilterBarProps = {
  filterLabel?: string;
  filters: readonly FilterOption[];
  searchLabel?: string;
  searchPlaceholder?: string;
  searchValue: string;
  selectedFilter: string;
};

/** Keeps directory filtering in the URL so searches, pagination, and browser navigation stay server-backed. */
export function FilterBar({
  filterLabel = "Contact filters",
  filters,
  searchLabel = "Search contacts",
  searchPlaceholder = "Search people, companies, or emails",
  searchValue,
  selectedFilter,
}: FilterBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchValue);

  function navigationUrl(nextFilter: string, nextSearch: string) {
    const params = new URLSearchParams(searchParams.toString());
    const trimmedSearch = nextSearch.trim();

    if (nextFilter === "all") params.delete("filter");
    else params.set("filter", nextFilter);
    if (trimmedSearch) params.set("search", trimmedSearch);
    else params.delete("search");
    params.delete("page");

    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[0_1px_2px_rgb(19_33_45/0.04)] lg:flex-row lg:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        router.push(navigationUrl(selectedFilter, search));
      }}
    >
      <label className="relative block min-w-0 flex-1">
        <span className="sr-only">{searchLabel}</span>
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-muted)]" />
        <Input className="pl-9" onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder} value={search} />
      </label>
      <div aria-label={filterLabel} className="flex items-center gap-1.5 overflow-x-auto">
        <SlidersIcon className="ml-1 size-4 shrink-0 text-[var(--ink-muted)]" />
        {filters.map((filter) => (
          <button
            aria-pressed={selectedFilter === filter.value}
            className={cn(
              "shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
              selectedFilter === filter.value
                ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                : "border-[var(--line)] bg-white text-[var(--ink-muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]",
            )}
            key={filter.value}
            onClick={() => router.push(navigationUrl(filter.value, search))}
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </div>
      <Button className="shrink-0" type="submit" variant="secondary">Apply</Button>
    </form>
  );
}
