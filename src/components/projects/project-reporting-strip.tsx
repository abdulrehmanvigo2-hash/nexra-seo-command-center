import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatShortDate } from "@/lib/format";
import {
  BAND_META,
  CADENCE_META,
  DELIVERY_NOTE_SHORT,
  DELIVERY_STATE_META,
  getReportsSnapshotCounts,
} from "@/lib/mock/reports";

/**
 * What this client is owed, on the project overview.
 *
 * A strip rather than a tab: the reports themselves live in the Reports
 * module, and this is the account lead's summary plus the way into them.
 *
 * Every figure is read from that module, so this panel and that workspace
 * never quote different numbers for the same project. The import direction is
 * deliberate — `reports/*` reads the canonical layers, and this component
 * reads back from the component layer rather than the fixture layer.
 */
export function ProjectReportingStrip({ projectId }: { projectId: string }) {
  const counts = getReportsSnapshotCounts(projectId);
  if (counts.reports === 0) return null;

  const figures: readonly {
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly detail: string;
    readonly tone?: "positive" | "warning" | "critical";
  }[] = [
    {
      id: "overdue",
      label: "Overdue",
      value: String(counts.overdue),
      detail: "Past the date and not yet approved or issued.",
      tone: counts.overdue > 0 ? "critical" : undefined,
    },
    {
      id: "due-soon",
      label: "Due within a week",
      value: String(counts.dueSoon),
      detail: "Counted from the reference date.",
      tone: counts.dueSoon > 0 ? "warning" : undefined,
    },
    {
      id: "ready",
      label: "Ready to go out",
      value: String(counts.ready),
      detail: "Every section a client would notice is filled.",
      tone: counts.ready > 0 ? "positive" : undefined,
    },
    {
      id: "schedules",
      label: "Schedules",
      value: String(counts.schedules),
      detail:
        counts.blockedRuns > 0
          ? `${counts.blockedRuns} blocked or paused.`
          : "All running. They prepare; they do not send.",
      tone: counts.blockedRuns > 0 ? "warning" : undefined,
    },
  ];

  return (
    <section className="rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-4 py-3 sm:px-5">
        <span className="flex items-center gap-2">
          <Icon name="reports" className="h-4 w-4 shrink-0 text-fg-subtle" />
          <span className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
            Reporting
          </span>
        </span>

        <span className="flex items-baseline gap-2">
          <span className="tabular text-[18px] leading-none font-semibold text-fg">
            {counts.reports}
          </span>
          <span className="text-[11px] text-fg-subtle">
            {counts.reports === 1 ? "report" : "reports"} on file
          </span>
        </span>

        <span
          className="tabular text-[12px] text-fg-muted"
          title={BAND_META[counts.band].description}
        >
          Mean completeness{" "}
          <span className="font-semibold text-fg">{counts.readiness}</span> /
          100
        </span>

        {counts.nextSchedule !== null && (
          <span
            className="text-[12px] text-fg-muted"
            title={DELIVERY_STATE_META[counts.nextSchedule.state].description}
          >
            {CADENCE_META[counts.nextSchedule.cadence].label} ·{" "}
            {DELIVERY_STATE_META[counts.nextSchedule.state].label.toLowerCase()}
          </span>
        )}

        <Link
          href={`/reports?project=${projectId}`}
          className={cn(buttonClasses("secondary", "sm"), "ml-auto")}
        >
          Open Reports
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 px-4 py-3.5 sm:px-5 lg:grid-cols-4">
        {figures.map((figure) => (
          <div
            key={figure.id}
            className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
          >
            <dt className="text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
              {figure.label}
            </dt>
            <dd
              className={cn(
                "tabular mt-1.5 text-[18px] leading-none font-semibold",
                figure.tone === "critical"
                  ? "text-critical"
                  : figure.tone === "warning"
                    ? "text-warning"
                    : figure.tone === "positive"
                      ? "text-positive"
                      : "text-fg",
              )}
            >
              {figure.value}
            </dd>
            <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">
              {figure.detail}
            </p>
          </div>
        ))}
      </dl>

      {counts.next !== null && (
        <p className="border-t border-border px-4 py-2.5 text-[11.5px] text-fg-muted sm:px-5">
          <span className="font-medium text-fg">Next:</span>{" "}
          <Link
            href={counts.next.href}
            className="transition-colors hover:text-accent"
          >
            {counts.next.templateName}, {counts.next.period.label}
          </Link>{" "}
          <span className="text-fg-subtle">
            due {formatShortDate(counts.next.dueAt)}.
          </span>
        </p>
      )}

      <p className="border-t border-border px-4 py-2.5 text-[11px] text-fg-subtle sm:px-5">
        {DELIVERY_NOTE_SHORT}
      </p>
    </section>
  );
}
