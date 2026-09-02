"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  ChevronDownIcon,
  HomeIcon,
  InboxIcon,
  TargetIcon,
  UsersIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";

const navigation = [
  {
    label: "CRM",
    icon: UsersIcon,
    items: [
      { href: "/contacts", label: "Contacts" },
      { href: "/companies", label: "Companies" },
    ],
  },
  {
    label: "Outreach",
    icon: TargetIcon,
    items: [
      { href: "/outreach/mailboxes", label: "Mailboxes" },
      { href: "/outreach/sequences", label: "Sequences" },
    ],
  },
  {
    label: "Inbox",
    icon: InboxIcon,
    items: [{ href: "/outreach/inbox", label: "Reply queue" }],
  },
] as const;

type TopNavigationProps = {
  collapsed?: boolean;
  mode: "sidebar" | "mobile";
};

function isCurrentRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarNavigation({
  collapsed,
  pathname,
}: {
  collapsed: boolean;
  pathname: string;
}) {
  const navigationRef = useRef<HTMLElement>(null);
  const activeSection = navigation.find((section) => section.items.some((item) => isCurrentRoute(pathname, item.href)))?.label ?? null;
  const [expandedSection, setExpandedSection] = useState<string | null>(collapsed ? null : activeSection);
  const overviewActive = pathname === "/";

  useEffect(() => {
    function closeNavigationOnOutsideClick(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Node && navigationRef.current && !navigationRef.current.contains(target)) {
        setExpandedSection(null);
      }
    }

    function closeNavigationOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      navigationRef.current?.querySelector<HTMLButtonElement>("button[aria-expanded='true']")?.focus();
      setExpandedSection(null);
    }

    document.addEventListener("pointerdown", closeNavigationOnOutsideClick);
    document.addEventListener("keydown", closeNavigationOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeNavigationOnOutsideClick);
      document.removeEventListener("keydown", closeNavigationOnEscape);
    };
  }, []);

  return (
    <nav aria-label="Workspace areas" className={cn("hidden min-h-0 flex-1 flex-col gap-3 py-5 lg:flex", collapsed ? "px-2" : "px-3")} ref={navigationRef}>
      <Link
        aria-current={overviewActive ? "page" : undefined}
        aria-label={collapsed ? "Overview" : undefined}
        className={cn(
          "flex items-center rounded-lg py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
          collapsed ? "justify-center px-2" : "gap-3 px-3",
          overviewActive ? "bg-white/15 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]" : "text-[#dbeaf5] hover:bg-white/10 hover:text-white",
        )}
        href="/"
        onClick={() => setExpandedSection(null)}
        title={collapsed ? "Overview" : undefined}
      >
        <HomeIcon className="size-4" />
        <span className={collapsed ? "sr-only" : undefined}>Overview</span>
      </Link>

      {navigation.map((section) => {
        const Icon = section.icon;
        const expanded = expandedSection === section.label;
        const dropdownId = `${section.label.toLowerCase()}-navigation`;

        return (
          <section className={cn(collapsed && "relative")} key={section.label}>
            <h2>
              <button
                aria-controls={dropdownId}
                aria-expanded={expanded}
                aria-label={collapsed ? section.label : undefined}
                className={cn(
                  "flex w-full items-center rounded-lg py-2.5 text-left text-sm font-semibold text-[#dbeaf5] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                  collapsed ? "justify-center px-2" : "gap-3 px-3",
                )}
                onClick={() => setExpandedSection((current) => current === section.label ? null : section.label)}
                title={collapsed ? section.label : undefined}
                type="button"
              >
                <Icon className="size-4" />
                <span className={collapsed ? "sr-only" : undefined}>{section.label}</span>
                <ChevronDownIcon className={cn("ml-auto size-3.5 transition-transform duration-200 motion-reduce:transition-none", collapsed && "hidden", expanded && "rotate-180")} />
              </button>
            </h2>
            <div
              aria-hidden={!expanded}
              className={cn(
                "transition-[grid-template-rows,opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                collapsed
                  ? "absolute left-[calc(100%+0.75rem)] top-0 z-30 w-52 rounded-xl border border-[var(--line)] bg-white p-1.5 shadow-[0_16px_38px_rgb(19_33_45/0.16)]"
                  : "grid overflow-hidden",
                expanded
                  ? collapsed ? "translate-x-0 opacity-100" : "grid-rows-[1fr] opacity-100"
                  : collapsed ? "pointer-events-none -translate-x-1 opacity-0" : "pointer-events-none grid-rows-[0fr] opacity-0",
              )}
              id={dropdownId}
            >
              <div className={cn("min-h-0", !collapsed && "overflow-hidden")}>
                <div className={cn("space-y-0.5", !collapsed && "mt-1")}>
                  {collapsed && <p className="px-3 py-1.5 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]">{section.label}</p>}
                  {section.items.map((item) => {
                    const itemActive = isCurrentRoute(pathname, item.href);

                    return (
                      <Link
                        aria-current={itemActive ? "page" : undefined}
                        className={cn(
                          "block rounded-lg py-2 text-sm font-medium focus-visible:outline-none",
                          collapsed ? "px-3 focus-visible:ring-2 focus-visible:ring-[var(--primary)]" : "pl-10 pr-3 focus-visible:ring-2 focus-visible:ring-white",
                          itemActive
                            ? collapsed ? "bg-[var(--primary-soft)] text-[var(--primary)]" : "bg-white/15 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
                            : collapsed ? "text-[var(--ink-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--ink)]" : "text-[#dbeaf5] hover:bg-white/10 hover:text-white",
                        )}
                        href={item.href}
                        key={item.href}
                        tabIndex={expanded ? 0 : -1}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </nav>
  );
}

/** Shared primary navigation for all authenticated workspace routes. */
export function TopNavigation({ collapsed = false, mode }: TopNavigationProps) {
  const pathname = usePathname();
  const overviewActive = pathname === "/";

  if (mode === "mobile") {
    return (
      <nav aria-label="Workspace areas" className="flex gap-1 overflow-x-auto border-t border-white/15 px-3 py-2 lg:hidden">
        <Link
          aria-current={overviewActive ? "page" : undefined}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
            overviewActive ? "bg-white/15 text-white" : "text-[#dbeaf5] hover:bg-white/10 hover:text-white",
          )}
          href="/"
        >
          <HomeIcon className="size-4" />
          Overview
        </Link>
        {navigation.flatMap((section) => {
          const Icon = section.icon;

          return section.items.map((item) => {
            const active = isCurrentRoute(pathname, item.href);

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                  active ? "bg-white/15 text-white" : "text-[#dbeaf5] hover:bg-white/10 hover:text-white",
                )}
                href={item.href}
                key={item.href}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          });
        })}
      </nav>
    );
  }

  return <SidebarNavigation collapsed={collapsed} key={`${pathname}-${collapsed}`} pathname={pathname} />;
}
