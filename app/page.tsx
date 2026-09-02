import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { HomeScreen } from "@/components/screens/home-screen";
import { getWorkspaceViewer } from "@/lib/auth/session";

export default async function HomePage() {
  const viewer = await getWorkspaceViewer();

  if (!viewer) {
    redirect("/login");
  }

  return <AppShell viewer={viewer}><HomeScreen /></AppShell>;
}
