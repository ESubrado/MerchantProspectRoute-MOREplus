import { AppShell } from "@/components/app-shell";
import { HomeScreen } from "@/components/screens/home-screen";
import { shellPreviewViewer } from "@/lib/auth/session";

export default function HomePage() {
  return <AppShell viewer={shellPreviewViewer}><HomeScreen /></AppShell>;
}
