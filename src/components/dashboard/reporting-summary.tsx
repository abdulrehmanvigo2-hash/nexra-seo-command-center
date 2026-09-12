import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatShortDate } from "@/lib/format";
import {
  BAND_META,
  DELIVERY_NOTE_SHORT,
  getReportsSnapshotCounts,
} from "@/lib/mock/reports";

/**
 * What is owed to clients, on the Command Center.
 *
 * A single line, because the dashboard is already dense and the question it
 * answers is small: is anything late, and is what we are about to send
 * complete. Everything else is one click away.
 *
 * Every figure is read from the Reports module, so this strip and that
 * workspace never quote different numbers.
 */
export function ReportingSummary({ projectId }: { projectId: string }) {
  const counts = getReportsSnapshotCounts(projectId);
  if (counts.reports === 0) return null;

  const href =
    projectId === "portfolio"
      ? "/reports"
      : `/reports?project=${projectId}`;

  return (
    <section className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-panel border border-border bg-surface px-4 py-3 sm:px-5">
      <span className="flex items-center gap-2">
        <Icon name="reports" className="h-4 w-4 shrink-0 text-fg-subtle" />
        <span className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
          Client reporting
        </span>
      </span>

      <span
        className={cn(
          "tabular inline-flex items-center gap-1.5 text-[12.5px] font-medium",
          counts.overdue > 0 ? "text-critical" : "text-positive",
        )}
        title={
          counts.overdue > 0
            ? "Past the due date and not yet approved or issued."
            : "Nothing is past its date without a decision on it."
        }
      >
        <Icon
          name={counts.overdue > 0 ? "alert" : "check"}
          className="h-3.5 w-3.5 shrink-0"
        />
        {counts.overdue > 0
          ? `${counts.overdue} overdue`
          : "Nothing overdue"}
      </span>

      <span className="text-[12px] text-fg-muted">
        {counts.reports} reports · {counts.ready} ready to go out ·{" "}
        {counts.dueSoon} due within a week
      </span>

      <span
        className="tabular text-[12px] text-fg-muted"
        title={BAND_META[counts.band].description}
      >
        Mean completeness{" "}
        <span className="font-semibold text-fg">{counts.readiness}</span> / 100
      </span>

      <Link
        href={href}
        className={cn(buttonClasses("secondary", "sm"), "ml-auto")}
      >
        Open Reports
        <Icon name="arrow-right" className="h-4 w-4" />
      </Link>

      <p className="w-full border-t border-border pt-2.5 text-[11.5px] text-fg-muted">
        {counts.next !== null ? (
          <>
            <span className="font-medium text-fg">Next up:</span>{" "}
            <Link
              href={counts.next.href}
              className="transition-colors hover:text-accent"
            >
              {counts.next.templateName} for {counts.next.projectName},{" "}
              {counts.next.period.label}
            </Link>{" "}
            <span className="text-fg-subtle">
              due {formatShortDate(counts.next.dueAt)}.
            </span>{" "}
          </>
        ) : (
          <>
            <span className="font-medium text-fg">Nothing outstanding.</span>{" "}
          </>
        )}
        <span className="text-fg-subtle">{DELIVERY_NOTE_SHORT}</span>
      </p>
    </section>
  );
}
