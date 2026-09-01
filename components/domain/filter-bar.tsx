"use client";

import { SearchIcon, SlidersIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type FilterOption = { label: string; value: string };

type FilterBarProps = {
  filters: readonly FilterOption[];
  onFilterChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  searchValue: string;
  selectedFilter: string;
};

export function FilterBar({ filters, onFilterChange, onSearchChange, searchValue, selectedFilter }: FilterBarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[0_1px_2px_rgb(19_33_45/0.04)] lg:flex-row lg:items-center">
      <label className="relative block min-w-0 flex-1">
        <span className="sr-only">Search contacts</span>
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-muted)]" />
        <Input onChange={(event) => onSearchChange(event.target.value)} placeholder="Search people, companies, or emails" value={searchValue} className="pl-9" />
      </label>
      <div aria-label="Contact filters" className="flex items-center gap-1.5 overflow-x-auto">
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
            onClick={() => onFilterChange(filter.value)}
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </div>
      <Button className="shrink-0" variant="secondary">Saved view</Button>
    </div>
  );
}
