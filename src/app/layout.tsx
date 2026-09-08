import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Nexra SEO Command Center",
    template: "%s · Nexra SEO Command Center",
  },
  description:
    "Agency-grade AI SEO operating platform for strategy, content, technical SEO, authority, and reporting.",
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
