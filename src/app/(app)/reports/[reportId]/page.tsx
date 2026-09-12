import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportPreview } from "@/components/reports/report-preview";
import { getReport, getReportIds } from "@/lib/mock/reports";

type PageParams = { params: Promise<{ reportId: string }> };

/**
 * Every report in the library is prerendered: a report exists for a project, a
 * template and a period the engagement was actually running in, so an id
 * outside that set is a broken link rather than a report nobody has written
 * yet. An unknown id renders on demand and falls through to `notFound()`, as
 * in Projects.
 */
export function generateStaticParams() {
  return getReportIds().map((reportId) => ({ reportId }));
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { reportId } = await params;
  const report = getReport(decodeURIComponent(reportId));

  if (!report) {
    return { title: "Report not found" };
  }

  return {
    title: `${report.templateName} · ${report.projectName}`,
    description: `${report.templateName} for ${report.client}, covering ${report.period.label}. Every figure is quoted from the module that publishes it, with its source named and its coverage stated.`,
  };
}

export default async function ReportDetailPage({ params }: PageParams) {
  const { reportId } = await params;
  const id = decodeURIComponent(reportId);

  if (!getReport(id)) {
    notFound();
  }

  return <ReportPreview reportId={id} />;
}
