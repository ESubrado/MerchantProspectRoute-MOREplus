"use client";

import { useActionState } from "react";

import { login } from "@/app/actions/auth";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, null);
  const errorId = "login-error";

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-[var(--ink)]" htmlFor="email">
          Work email
        </label>
        <input
          autoComplete="email"
          className="h-11 w-full rounded-lg border border-[var(--line-strong)] bg-white px-3 text-sm text-[var(--ink)] outline-none placeholder:text-[#81909d] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
          id="email"
          name="email"
          placeholder="you@company.com"
          required
          type="email"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-[var(--ink)]" htmlFor="password">
          Password
        </label>
        <input
          aria-describedby={state?.error ? errorId : undefined}
          autoComplete="current-password"
          className="h-11 w-full rounded-lg border border-[var(--line-strong)] bg-white px-3 text-sm text-[var(--ink)] outline-none placeholder:text-[#81909d] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
          id="password"
          name="password"
          placeholder="Enter your password"
          required
          type="password"
        />
      </div>

      {state?.error ? (
        <p className="rounded-lg border border-[rgb(174_48_65/0.24)] bg-[var(--danger-soft)] px-3 py-2.5 text-sm leading-5 text-[var(--danger)]" id={errorId} role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        className="flex h-11 w-full items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-white shadow-[0_1px_2px_rgb(19_33_45/0.16)] transition-colors hover:bg-[var(--primary-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65"
        disabled={pending}
        type="submit"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
