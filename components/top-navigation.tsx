"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import {
  ChevronDownIcon,
  HomeIcon,
  InboxIcon,
  SettingsIcon,
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
  {
    label: "Administration",
    icon: SettingsIcon,
    items: [{ href: "/administration", label: "Workspace settings" }],
  },
] as const;

type TopNavigationProps = {
  mode: "desktop" | "mobile";
};

/** Shared primary navigation for all authenticated workspace routes. */
export function TopNavigation({ mode }: TopNavigationProps) {
  const pathname = usePathname();
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const overviewActive = pathname === "/";

  if (mode === "mobile") {
    return (
      <nav aria-label="Workspace areas" className="flex gap-1 overflow-x-auto border-t border-[var(--line)] px-3 py-2 lg:hidden">
        <Link
          aria-current={overviewActive ? "page" : undefined}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
            overviewActive ? "bg-[var(--primary-soft)] text-[var(--primary)]" : "text-[var(--ink-muted)]",
          )}
          href="/"
        >
          <HomeIcon className="size-4" />
          Overview
        </Link>
        {navigation.map((section) => {
          const Icon = section.icon;
          const href = section.items[0].href;
          const active = section.items.some((item) => pathname === item.href);

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                active ? "bg-[var(--primary-soft)] text-[var(--primary)]" : "text-[var(--ink-muted)]",
              )}
              href={href}
              key={section.label}
            >
              <Icon className="size-4" />
              {section.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Workspace areas" className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex">
      <Link
        aria-current={overviewActive ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
          overviewActive ? "bg-[var(--primary-soft)] text-[var(--primary)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--ink)]",
        )}
        href="/"
      >
        <HomeIcon className="size-4" />
        Overview
      </Link>
      {navigation.map((section) => {
        const Icon = section.icon;
        const active = section.items.some((item) => pathname === item.href);

        return (
          <details
            className="group relative"
            key={section.label}
            onToggle={(event) => {
              if (event.currentTarget.open) {
                setExpandedSection(section.label);
                setExpandedPath(pathname);
              } else {
                setExpandedSection(null);
                setExpandedPath(null);
              }
            }}
            open={expandedSection === section.label && expandedPath === pathname}
          >
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                active ? "bg-[var(--primary-soft)] text-[var(--primary)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--ink)]",
              )}
            >
              <Icon className="size-4" />
              {section.label}
              <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 min-w-48 rounded-xl border border-[var(--line)] bg-white p-1.5 shadow-[0_16px_38px_rgb(19_33_45/0.14)]">
              {section.items.map((item) => (
                <Link
                  aria-current={pathname === item.href ? "page" : undefined}
                  className={cn(
                    "block rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                    pathname === item.href ? "bg-[var(--primary-soft)] text-[var(--primary)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--ink)]",
                  )}
                  href={item.href}
                  key={item.href}
                  onClick={() => {
                    setExpandedSection(null);
                    setExpandedPath(null);
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </details>
        );
      })}
    </nav>
  );
}
