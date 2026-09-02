import Image from "next/image";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getWorkspaceViewer } from "@/lib/auth/session";

export const metadata = { title: "Sign in" };

type LoginPageProps = {
  searchParams: Promise<{ reason?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [viewer, parameters] = await Promise.all([getWorkspaceViewer(), searchParams]);
  // This untrusted URL value controls only explanatory copy; authorization always comes from getWorkspaceViewer.
  const needsWorkspaceAccess = parameters.reason === "workspace-access";

  if (viewer) {
    redirect("/");
  }

  return (
    <main className="grid min-h-screen bg-[var(--canvas)] lg:grid-cols-[minmax(0,1.08fr)_minmax(28rem,0.92fr)]">
      <section className="relative hidden overflow-hidden bg-[var(--primary)] px-8 py-10 text-white lg:flex lg:flex-col xl:px-14">
        <div aria-hidden="true" className="absolute -left-32 top-24 size-96 rounded-full border border-white/10" />
        <div aria-hidden="true" className="absolute -bottom-56 -right-16 size-[35rem] rounded-full border-[28px] border-white/5" />

        <div className="relative flex items-center gap-2.5">
          <span aria-hidden="true" className="flex size-7 items-center justify-center">
            <Image alt="" className="size-7" height={28} priority src="/surnmore-logo.svg" width={28} />
          </span>
          <span className="text-base font-medium tracking-tight">SÜRNMORE</span>
        </div>

        <div className="relative my-auto max-w-xl py-20">
          <p className="mb-4 text-xs font-bold tracking-[0.16em] text-[#cce0f2] uppercase">Revenue operations, in focus</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight xl:text-[2.75rem]">Turn outbound activity into clear next steps.</h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-[#dbeaf5]">Bring contacts, sending health, active sequences, and every reply into one calm operating workspace.</p>

          <div className="mt-10 grid max-w-md grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
              <p className="text-xs font-semibold tracking-wide text-[#cce0f2] uppercase">Reply queue</p>
              <p className="mt-2 text-2xl font-semibold">Prioritized</p>
              <p className="mt-1 text-sm text-[#dbeaf5]">Stay close to buyer intent.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
              <p className="text-xs font-semibold tracking-wide text-[#cce0f2] uppercase">Workspace</p>
              <p className="mt-2 text-2xl font-semibold">Shared</p>
              <p className="mt-1 text-sm text-[#dbeaf5]">Give every owner context.</p>
            </div>
          </div>
        </div>

        <p className="relative text-sm text-[#cce0f2]">Secure workspace access for your revenue team.</p>
      </section>

      <section className="flex min-h-screen flex-col bg-white px-5 py-6 sm:px-10 lg:px-14 lg:py-10">
        <div className="flex items-center gap-2.5 lg:hidden">
          <span aria-hidden="true" className="flex size-7 items-center justify-center">
            <Image alt="" className="size-7" height={28} priority src="/surnmore-logo.svg" width={28} />
          </span>
          <span className="text-base font-medium tracking-tight text-[var(--ink)]">SÜRNMORE</span>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 items-center py-12">
          <div className="w-full">
            <p className="text-xs font-bold tracking-[0.14em] text-[var(--teal)] uppercase">Welcome back</p>
            <h2 className="mt-3 text-[2rem] font-semibold tracking-tight text-[var(--ink)]">Sign in to your workspace</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">Use your team email and password to continue to SurnMore.</p>

            {needsWorkspaceAccess ? (
              <p className="mt-5 rounded-lg border border-[rgb(184_134_27/0.3)] bg-[#fff8e7] px-3 py-2.5 text-sm leading-5 text-[#7a5700]" role="status">
                Your account is signed in, but it is not assigned to an active workspace. Ask a workspace administrator to grant access, then sign in again.
              </p>
            ) : null}

            <div className="mt-8 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_1px_2px_rgb(19_33_45/0.05)] sm:p-6">
              <LoginForm />
            </div>
          </div>
        </div>

        <p className="text-center text-xs leading-5 text-[var(--ink-muted)]">Having trouble signing in? Contact your workspace administrator.</p>
      </section>
    </main>
  );
}
