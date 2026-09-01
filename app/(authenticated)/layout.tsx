import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { shellPreviewViewer } from "@/lib/auth/session";

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <AppShell viewer={shellPreviewViewer}>{children}</AppShell>;
}
