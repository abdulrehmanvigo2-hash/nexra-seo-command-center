import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/ui/page-placeholder";

export const metadata: Metadata = {
  title: "AI Agents",
};

export default function AgentsPage() {
  return <PagePlaceholder href="/agents" />;
}
