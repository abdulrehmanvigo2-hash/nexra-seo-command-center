import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { formatCompact, formatRelative } from "@/lib/format";
import type { CheckStatus, TechnicalSnapshot as Snapshot } from "@/types/dashboard";

/**
 * Compact site-health view.
 *
 * The full diagnostics live in the Technical SEO module, which is built in its
 * own phase; this panel links there rather than duplicating it. Severity is
 * shown as a dot plus a word, never as colour alone.
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
}: {
  snapshot: Snapshot;
  referenceIso: string;
}) {
  const critical = snapshot.checks.filter(
    (check) => check.status === "critical",
  ).length;
  const warnings = snapshot.checks.filter(
    (check) => check.status === "warning",
  ).length;

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
                {snapshot.score}
              </span>
              <span className="text-[12.5px] text-fg-subtle">/ 100</span>
              <TrendIndicator value={snapshot.trend.value} />
            </p>
          </div>

          <dl className="flex items-center gap-5 text-[12px]">
            <div>
              <dt className="text-fg-subtle">Critical</dt>
              <dd className="tabular mt-0.5 text-[15px] font-semibold text-critical">
                {critical}
              </dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Warnings</dt>
              <dd className="tabular mt-0.5 text-[15px] font-semibold text-warning">
                {warnings}
              </dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Passing</dt>
              <dd className="tabular mt-0.5 text-[15px] font-semibold text-positive">
                {snapshot.checks.length - critical - warnings}
              </dd>
            </div>
          </dl>
        </div>

        <Meter
          className="mt-3.5"
          value={snapshot.score}
          tone={
            snapshot.score >= 75 ? "positive"
            : snapshot.score >= 55 ? "warning"
            : "critical"
          }
          label={`Technical health: ${snapshot.score} out of 100`}
        />
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
        <span>Full diagnostics arrive with the Technical SEO module.</span>
        <Link href="/technical" className={buttonClasses("secondary", "sm")}>
          Open Technical SEO
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}
