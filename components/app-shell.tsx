"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { ChevronDownIcon } from "@/components/icons";
import { TopNavigation } from "@/components/top-navigation";
import type { WorkspaceViewer } from "@/lib/auth/session";

export function AppShell({ children, viewer }: { children: ReactNode; viewer: WorkspaceViewer }) {
  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex min-h-17 max-w-[90rem] items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2" href="/">
            <span aria-hidden="true" className="isolate grid size-8 place-items-center overflow-hidden rounded-lg bg-[var(--primary)] shadow-[0_1px_2px_rgb(19_33_45/0.16)]">
              <Image alt="" className="block size-full mix-blend-screen" height={32} priority src="/surnmore-logo.svg" width={32} />
            </span>
            <span className="text-base font-semibold tracking-tight text-[var(--ink)]">SurnMore</span>
          </Link>

          <TopNavigation mode="desktop" />

          <div className="ml-auto flex items-center gap-2">
            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-sm font-semibold text-[var(--ink)] marker:content-none hover:border-[var(--line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                <span className="grid size-6 place-items-center rounded-md bg-[var(--teal-soft)] text-xs font-bold text-[var(--teal)]">H</span>
                <span className="hidden max-w-28 truncate sm:block">{viewer.workspaceName}</span>
                <ChevronDownIcon className="size-3.5 text-[var(--ink-muted)]" />
              </summary>
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-64 rounded-xl border border-[var(--line)] bg-white p-2 shadow-[0_16px_38px_rgb(19_33_45/0.14)]">
                <p className="px-2 py-1 text-xs font-semibold tracking-wide text-[var(--ink-muted)] uppercase">Current workspace</p>
                <div className="rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-sm font-semibold text-[var(--ink)]">{viewer.workspaceName}</div>
                <p className="px-2 pb-1 pt-3 text-xs text-[var(--ink-muted)]">Workspace switching will connect after authentication is configured.</p>
              </div>
            </details>

            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg p-1.5 marker:content-none hover:bg-[var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                <span className="grid size-7 place-items-center rounded-full bg-[var(--ink)] text-xs font-bold text-white">WU</span>
                <span className="hidden text-left text-sm sm:block">
                  <span className="block font-semibold text-[var(--ink)]">{viewer.displayName}</span>
                  <span className="block text-xs text-[var(--ink-muted)]">{viewer.role}</span>
                </span>
              </summary>
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-56 rounded-xl border border-[var(--line)] bg-white p-2 shadow-[0_16px_38px_rgb(19_33_45/0.14)]">
                <p className="px-2 py-1 text-xs font-semibold tracking-wide text-[var(--ink-muted)] uppercase">Account</p>
                <button className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" type="button">Account controls pending authentication</button>
              </div>
            </details>
          </div>
        </div>

        <TopNavigation mode="mobile" />
      </header>

      <main className="mx-auto w-full max-w-[90rem] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">{children}</main>
    </div>
  );
}
