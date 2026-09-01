import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SurnMore",
    template: "%s | SurnMore",
  },
  description: "A focused operating system for outbound revenue teams.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en"><body>{children}</body></html>;
}
