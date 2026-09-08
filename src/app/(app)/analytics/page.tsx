import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/ui/page-placeholder";

export const metadata: Metadata = {
  title: "Analytics",
};

export default function AnalyticsPage() {
  return <PagePlaceholder href="/analytics" />;
}
