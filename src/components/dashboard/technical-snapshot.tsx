import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { formatCompact, formatPercent, formatRelative } from "@/lib/format";
import { getTechnicalSnapshotCounts } from "@/lib/mock/technical";
import type { CheckStatus, TechnicalSnapshot as Snapshot } from "@/types/dashboard";

/**
 * Compact site-health view.
 *
 * The headline score and the countable figures are read from the Technical SEO
 * module, so this panel and that module never quote different numbers for the
 * same site. The vitals and the named checks below remain this dashboard's own
 * qualitative summary; the full diagnostics live in the module, and the footer
 * links into it scoped to the project on screen.
 *
 * Severity is shown as a dot plus a word, never as colour alone.
 */

const STATUS_DOT: Record<CheckStatus, string> = {
  healthy: "bg-positive",
  warning: "bg-warning",
  critical: "bg-critical",
};

const STATUS_TEXT: Record<CheckStatus, string> = {
  healthy: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
};

const STATUS_LABEL: Record<CheckStatus, string> = {
  healthy: "Healthy",
  warning: "Needs attention",
  critical: "Critical",
};

export function TechnicalSnapshot({
  snapshot,
  referenceIso,
  /** Scopes the derived figures and the link into the module. */
  projectId,
}: {
  snapshot: Snapshot;
  referenceIso: string;
  projectId: string;
}) {
  const counts = getTechnicalSnapshotCounts(projectId);
  const href =
    projectId === "portfolio" ? "/technical" : `/technical?project=${projectId}`;

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Site health"
        title="Technical SEO Snapshot"
        description={`${formatCompact(snapshot.crawledPages)} URLs crawled · last crawl ${formatRelative(snapshot.lastCrawl, referenceIso)}`}
      />

      <PanelBody className="border-b border-border">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <p className="text-[11.5px] font-medium tracking-[0.03em] text-fg-muted uppercase">
              Technical health score
            </p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="tabular text-[30px] leading-none font-semibold tracking-tight text-fg">
                {counts.health}
              </span>
              <span className="text-[12.5px] text-fg-subtle">/ 100</span>
              <TrendIndicator value={snapshot.trend.value} />
            </p>
          </div>

          <dl className="flex items-center gap-5 text-[12px]">
            <div>
              <dt className="text-fg-subtle">Critical issues</dt>
              <dd className="tabular mt-0.5 text-[15px] font-semibold text-critical">
                {counts.criticalIssues}
              </dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Pages affected</dt>
              <dd className="tabular mt-0.5 text-[15px] font-semibold text-warning">
                {counts.affectedPages}
              </dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Indexed</dt>
              <dd className="tabular mt-0.5 text-[15px] font-semibold text-positive">
                {counts.indexed}
              </dd>
            </div>
          </dl>
        </div>

        <Meter
          className="mt-3.5"
          value={counts.health}
          tone={
            counts.health >= 75 ? "positive"
            : counts.health >= 55 ? "warning"
            : "critical"
          }
          label={`Technical health: ${counts.health} out of 100`}
        />

        <p className="mt-2.5 text-[11.5px] text-fg-subtle">
          Of the {counts.pages} pages in the published content inventory,{" "}
          {counts.crawlable} are crawlable and{" "}
          {formatPercent(counts.coverage, 0)} of the indexable ones are in the
          index.
        </p>
      </PanelBody>

      <PanelBody className="border-b border-border">
        <p className="text-[11px] font-semibold tracking-[0.07em] text-fg-subtle uppercase">
          Core Web Vitals
        </p>
        <ul className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
          {snapshot.vitals.map((vital) => (
            <li
              key={vital.id}
              className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] font-medium text-fg-muted">
                  {vital.label}
                </span>
                <span
                  aria-hidden="true"
                  className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[vital.status])}
                />
              </div>
              <p className="tabular mt-1 text-[16px] leading-none font-semibold text-fg">
                {vital.value}
              </p>
              <p className="mt-1.5 text-[11px] text-fg-subtle">
                Target {vital.target} · {vital.passRate}% pass
              </p>
              <span className="sr-only">{STATUS_LABEL[vital.status]}</span>
            </li>
          ))}
        </ul>
      </PanelBody>

      <div className="flex-1">
        <ul className="divide-y divide-border">
          {snapshot.checks.map((check) => (
            <li
              key={check.id}
              className="flex items-center justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-surface-raised/60 sm:px-5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    STATUS_DOT[check.status],
                  )}
                />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-fg">
                    {check.label}
                    <span className="sr-only"> — {STATUS_LABEL[check.status]}</span>
                  </p>
                  <p className="truncate text-[11.5px] text-fg-subtle">
                    {check.detail}
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  "tabular shrink-0 text-[13px] font-semibold",
                  STATUS_TEXT[check.status],
                )}
              >
                {check.value}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <PanelFooter>
        <span>
          {counts.topIssue
            ? `${counts.topIssue.label} is the first thing to fix, across ${counts.openIssues} open findings.`
            : `Nothing is open against these ${counts.pages} URLs.`}
        </span>
        <Link href={href} className={buttonClasses("secondary", "sm")}>
          Open Technical SEO
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}
