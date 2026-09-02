"use client";

import Image, { type ImageLoaderProps } from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { logout } from "@/app/actions/auth";
import { LogOutIcon, PanelLeftIcon, SettingsIcon, UserIcon } from "@/components/icons";
import { TopNavigation } from "@/components/top-navigation";
import type { WorkspaceViewer } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

function initials(name: string) {
  const parts = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]);
  const firstInitial = parts[0];
  const lastInitial = parts[parts.length - 1];

  return `${firstInitial ?? ""}${lastInitial === firstInitial ? "" : lastInitial ?? ""}`.toUpperCase() || "?";
}

function avatarLoader({ src }: ImageLoaderProps) {
  return src;
}

function ProfileAvatar({
  avatarUrl,
  fallbackClassName,
  imageClassName,
}: {
  avatarUrl: string | null;
  fallbackClassName: string;
  imageClassName: string;
}) {
  if (avatarUrl) {
    return <Image alt="" className={`size-8 rounded-full border object-cover ${imageClassName}`} height={32} loader={avatarLoader} src={avatarUrl} unoptimized width={32} />;
  }

  return <span aria-hidden="true" className={`grid size-8 place-items-center rounded-full ${fallbackClassName}`}><UserIcon className="size-4" /></span>;
}

function AccountMenu({
  menuRef,
  viewer,
  placement,
}: {
  menuRef: RefObject<HTMLDetailsElement | null>;
  viewer: WorkspaceViewer;
  placement: "up" | "down";
}) {
  const menuPosition = placement === "up"
    ? "bottom-[calc(100%+0.5rem)] left-0"
    : "right-0 top-[calc(100%+0.5rem)]";

  return (
    <details className="group relative" ref={menuRef}>
      <summary aria-label="Open account menu" className="flex cursor-pointer list-none items-center rounded-lg p-1.5 marker:content-none hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
        <ProfileAvatar avatarUrl={viewer.avatarUrl} fallbackClassName="border border-white/40 bg-white/15 text-white" imageClassName="border-white/40" />
      </summary>
      <div className={`absolute z-20 w-64 rounded-xl border border-[var(--line)] bg-white p-1.5 shadow-[0_16px_38px_rgb(19_33_45/0.14)] ${menuPosition}`}>
        <div className="flex items-center gap-2 px-2 py-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-[var(--primary-soft)] text-xs font-bold text-[var(--primary)]">{initials(viewer.displayName)}</span>
          <div className="min-w-0 text-sm leading-tight">
            <span className="block truncate font-semibold text-[var(--ink)]">{viewer.displayName}</span>
            <span className="block truncate text-xs text-[var(--ink-muted)]">{viewer.email}</span>
          </div>
        </div>
        <div className="my-1 border-t border-[var(--line)]" />
        <Link
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          href="/administration"
          onClick={() => {
            if (menuRef.current) menuRef.current.open = false;
          }}
        >
          <SettingsIcon className="size-4" />
          Workspace settings
        </Link>
        <form action={logout}>
          <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" type="submit">
            <LogOutIcon className="size-4" />
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}

export function AppShell({ children, viewer }: { children: ReactNode; viewer: WorkspaceViewer }) {
  const sidebarAccountMenuRef = useRef<HTMLDetailsElement>(null);
  const mobileAccountMenuRef = useRef<HTMLDetailsElement>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);

  useEffect(() => {
    function closeAccountMenu(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) return;

      [sidebarAccountMenuRef.current, mobileAccountMenuRef.current].forEach((menu) => {
        if (menu?.open && !menu.contains(target)) {
          menu.open = false;
        }
      });
    }

    function closeAccountMenuOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      const openMenu = [sidebarAccountMenuRef.current, mobileAccountMenuRef.current].find((menu) => menu?.open);

      if (openMenu) {
        openMenu.open = false;
        openMenu.querySelector("summary")?.focus();
      }
    }

    document.addEventListener("pointerdown", closeAccountMenu);
    document.addEventListener("keydown", closeAccountMenuOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeAccountMenu);
      document.removeEventListener("keydown", closeAccountMenuOnEscape);
    };
  }, []);

  return (
    <div className={cn("min-h-screen bg-[var(--canvas)] text-[var(--ink)] lg:grid lg:transition-[grid-template-columns] lg:duration-200 lg:ease-out motion-reduce:lg:transition-none", sidebarExpanded ? "lg:grid-cols-[17rem_minmax(0,1fr)]" : "lg:grid-cols-[4.75rem_minmax(0,1fr)]")}>
      <aside className="relative hidden h-screen flex-col border-r border-[var(--primary-strong)] bg-[var(--primary)] lg:sticky lg:top-0 lg:flex">
        <div className={cn("flex min-h-17 items-center border-b border-white/12", sidebarExpanded ? "px-5" : "justify-center px-3")}>
          <Link aria-label="Surnmore overview" className={cn("flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--primary)]", !sidebarExpanded && "[&>span:last-child]:sr-only")} href="/">
            <span aria-hidden="true" className="flex size-8 items-center justify-center">
              <Image alt="" className="size-8" height={32} priority src="/surnmore-logo.svg" width={32} />
            </span>
            <span className="text-base font-medium tracking-tight text-white">SÜRNMORE</span>
          </Link>
        </div>

        <button
          aria-label={sidebarExpanded ? "Collapse navigation" : "Expand navigation"}
          aria-pressed={sidebarExpanded}
          className="absolute -right-3 top-5 z-10 grid size-6 place-items-center rounded-full border border-[var(--line)] bg-white text-[var(--primary)] shadow-sm hover:bg-[var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          onClick={() => setSidebarExpanded((current) => !current)}
          title={sidebarExpanded ? "Collapse navigation" : "Expand navigation"}
          type="button"
        >
          <PanelLeftIcon className={cn("size-3.5 transition-transform duration-200 motion-reduce:transition-none", !sidebarExpanded && "rotate-180")} />
        </button>

        <TopNavigation collapsed={!sidebarExpanded} mode="sidebar" />

        <div className={cn("border-t border-white/12 py-3", sidebarExpanded ? "px-4" : "flex justify-center px-2")}>
          <AccountMenu menuRef={sidebarAccountMenuRef} placement="up" viewer={viewer} />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="border-b border-[var(--primary-strong)] bg-[var(--primary)] lg:hidden">
          <div className="flex min-h-17 items-center gap-4 px-4 sm:px-6">
            <Link className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--primary)]" href="/">
              <span aria-hidden="true" className="flex size-8 items-center justify-center">
                <Image alt="" className="size-8" height={32} priority src="/surnmore-logo.svg" width={32} />
              </span>
              <span className="text-base font-medium tracking-tight text-white">SÜRNMORE</span>
            </Link>
            <div className="ml-auto">
              <AccountMenu menuRef={mobileAccountMenuRef} placement="down" viewer={viewer} />
            </div>
          </div>
          <TopNavigation mode="mobile" />
        </header>

        <main className="mx-auto w-full max-w-[90rem] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">{children}</main>
      </div>
    </div>
  );
}
