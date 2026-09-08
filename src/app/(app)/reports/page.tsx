import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/ui/page-placeholder";

export const metadata: Metadata = {
  title: "Reports",
};

export default function ReportsPage() {
  return <PagePlaceholder href="/reports" />;
}
