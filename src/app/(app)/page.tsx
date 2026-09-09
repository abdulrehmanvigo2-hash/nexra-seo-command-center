import type { Metadata } from "next";
import { CommandCenter } from "@/components/dashboard/command-center";

export const metadata: Metadata = {
  title: "Command Center",
  description:
    "Cross-project overview of SEO health, active priorities, and live agent activity.",
};

export default function CommandCenterPage() {
  return <CommandCenter />;
}
