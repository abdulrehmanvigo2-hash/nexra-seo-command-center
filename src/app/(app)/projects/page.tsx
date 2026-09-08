import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/ui/page-placeholder";

export const metadata: Metadata = {
  title: "Projects",
};

export default function ProjectsPage() {
  return <PagePlaceholder href="/projects" />;
}
