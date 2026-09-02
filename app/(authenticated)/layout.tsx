import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getWorkspaceViewer } from "@/lib/auth/session";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const viewer = await getWorkspaceViewer();

  if (!viewer) {
    // A verified session without a usable membership needs setup guidance, not an unexplained login loop.
    redirect("/login?reason=workspace-access");
  }

  return <AppShell viewer={viewer}>{children}</AppShell>;
}
