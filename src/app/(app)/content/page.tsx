import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/ui/page-placeholder";

export const metadata: Metadata = {
  title: "Content Studio",
};

export default function ContentStudioPage() {
  return <PagePlaceholder href="/content" />;
}
