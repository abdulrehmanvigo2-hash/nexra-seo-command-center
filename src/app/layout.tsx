import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Nexra SEO Command Center",
    template: "%s · Nexra SEO Command Center",
  },
  description:
    "Agency-grade AI SEO operating platform for strategy, content, technical SEO, authority, and reporting.",
  // A private operator tool: no page is indexed or followed (the X-Robots-Tag header says the same on every response).
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0c0e",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
