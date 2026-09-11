"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/cn";
import { formatCompact, formatCurrencyCompact } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import {
  ANALYTICS_SOURCE_NOTE,
  ATTRIBUTION_NOTE,
  METRIC_META,
} from "@/lib/mock/analytics";
import {
  AnomalyKindBadge,
  ConfidenceTag,
  DeltaValue,
  DistributionList,
  PageLink,
  ProvenanceTag,
  SignificanceBadge,
  TrafficValue,
  VerdictBadge,
} from "@/components/analytics/analytics-chrome";
import type { AnalyticsOverview } from "@/types/analytics";

/**
 * The executive reading.
 *
 * Every figure describes the same selection and window as every table below
 * it, because all of them come from one `getAnalyticsOverview` call rather
 * than being assembled separately per card.
 *
 * The four headline metrics show their movement band as well as their change,
 * so a reader can see at a glance which numbers are actually saying something
 * and which are inside the range this dataset moves in anyway.
 */
export function OverviewView({
  overview,
  onOpenTab,
}: {
  overview: AnalyticsOverview;
  onOpenTab: (tab: string) => void;
}) {
  if (overview.series.current.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="analytics"
          title="No series for this selection"
          description="Pick a project with measured performance, or widen the window."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Headline"
          title={`Performance over the ${overview.series.range.caption.toLowerCase()}`}
          description={`Each figure is shown with how much the change actually says — ${overview.series.range.comparison}.`}
          actions={<ProvenanceTag provenance="series" />}
        />
        <PanelBody>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {overview.readings.map((reading) => {
              const values = overview.series.current.map(
                (point) => point[reading.id],
              );

              return (
                <li
                  key={reading.id}
                  className="rounded-md border border-border bg-surface-raised px-3 py-3"
                >
                  <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
                    <Icon
                      name={reading.icon}
                      className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                    />
                    <span className="min-w-0 truncate">{reading.label}</span>
                  </p>

                  <p className="mt-2 flex items-baseline gap-1.5">
                    <span className="tabular text-[22px] leading-none font-semibold text-fg">
                      {reading.value}
                    </span>
                    {METRIC_META[reading.id].unit && (
                      <span className="text-[11px] text-fg-subtle">
                        {METRIC_META[reading.id].unit}
                      </span>
                    )}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <DeltaValue
                      delta={reading.delta}
                      direction={reading.direction}
                    />
                    <SignificanceBadge significance={reading.significance} />
                  </div>

                  <div className="mt-2.5">
                    <Sparkline
                      values={values}
                      tone={
                        reading.direction === "down" ? "critical" : "accent"
                      }
                    />
                  </div>

                  <p className="mt-2 text-[11px] leading-snug text-fg-subtle">
                    {reading.detail}
                  </p>
                </li>
              );
            })}
          </ul>
        </PanelBody>
        <PanelFooter>
          <span>{ANALYTICS_SOURCE_NOTE}</span>
        </PanelFooter>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel>
          <PanelHeader
            eyebrow="Distribution"
            title="Pages by performance"
            description="Measured against each page's own potential, not against each other."
          />
          <PanelBody>
            <DistributionList rows={overview.pageStates} />
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={() => onOpenTab("pages")}>
              All pages
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>

        <Panel className="xl:col-span-2">
          <PanelHeader
            eyebrow="Where the room is"
            title="Largest unclaimed opportunity"
            description="Ordered by sessions available rather than by size — the biggest cluster is the biggest cluster every window."
          />
          {overview.contributors.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="No headroom in this selection"
              description="Every segment is carrying what its keywords could support."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.contributors.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-fg">
                      {row.label}
                    </span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {row.projectName} · {row.keywords} keywords ·{" "}
                      {row.pages} pages
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="tabular hidden text-[11.5px] text-fg-subtle sm:inline">
                      {formatCompact(row.traffic)} of {formatCompact(row.potential)}
                    </span>
                    <span className="tabular text-[12.5px] font-semibold text-fg">
                      +{formatCompact(row.potential - row.traffic)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <span>
              {formatCompact(Math.round(overview.headroom))} sessions a month
              across the selection, worth{" "}
              {formatCurrencyCompact(Math.round(overview.opportunityValue))}
            </span>
            <Button variant="ghost" onClick={() => onOpenTab("segments")}>
              Segments
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Worth explaining"
            title="Movements found"
            description="Only movements large enough to say something are raised at all."
          />
          {overview.anomalies.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="Nothing unusual"
              description="No movement in this window is large enough to read into."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.anomalies.slice(0, 6).map((anomaly) => (
                <li key={anomaly.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 truncate text-[12.5px] font-medium text-fg">
                      {anomaly.label}
                    </span>
                    <ConfidenceTag confidence={anomaly.confidence} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <AnomalyKindBadge kind={anomaly.kind} />
                    <SignificanceBadge significance={anomaly.significance} />
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-fg-muted">
                    {anomaly.finding}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
                    {anomaly.explanation ??
                      "Nothing in the other modules accounts for this."}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <Button variant="ghost" onClick={() => onOpenTab("anomalies")}>
              All movements
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Routed to the Director"
            title="Learnings"
            description="What the evidence supports doing next cycle."
          />
          {overview.learnings.length === 0 ? (
            <EmptyState
              size="sm"
              icon="sparkles"
              title="Nothing to route yet"
              description="Not enough is happening in this selection to draw a conclusion from."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.learnings.slice(0, 5).map((learning) => (
                <li key={learning.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 text-[12.5px] font-medium text-fg">
                      {learning.headline}
                    </span>
                    <ConfidenceTag confidence={learning.confidence} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <VerdictBadge verdict={learning.verdict} />
                    <span className="text-[11.5px] text-fg-subtle">
                      {AGENT_NAMES[learning.owner]}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-fg-subtle">
                    {learning.recommendation}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <Button variant="ghost" onClick={() => onOpenTab("learnings")}>
              All learnings
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Carrying the most"
            title="Top pages"
            description="Where the organic traffic in this selection actually comes from."
          />
          <ul className="divide-y divide-border">
            {overview.topPages.map((page) => (
              <li
                key={page.contentId}
                className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
              >
                <span className="min-w-0 flex-1">
                  <PageLink
                    contentId={page.contentId}
                    title={page.title}
                    path={page.path}
                  />
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span
                    className={cn(
                      "tabular hidden text-[11.5px] sm:inline",
                      page.positionChange > 0
                        ? "text-positive"
                        : page.positionChange < 0
                          ? "text-critical"
                          : "text-fg-subtle",
                    )}
                  >
                    {page.positionChange > 0 ? "+" : ""}
                    {page.positionChange}
                  </span>
                  <TrafficValue sessions={page.traffic} />
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Losing ground"
            title="Decaying pages"
            description="Cheaper to catch now than to rebuild after the traffic has gone."
          />
          {overview.decayingPages.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="Nothing decaying"
              description="No page in this selection is losing position."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.decayingPages.map((page) => (
                <li
                  key={page.contentId}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <PageLink
                      contentId={page.contentId}
                      title={page.title}
                      path={page.path}
                    />
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="tabular text-[12px] font-medium text-critical">
                      {page.positionChange}
                    </span>
                    <TrafficValue sessions={page.traffic} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <Button variant="ghost" onClick={() => onOpenTab("pages")}>
              All pages
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          </PanelFooter>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          eyebrow="Work beside movement"
          title="Attribution shortlist"
          description={ATTRIBUTION_NOTE}
        />
        {overview.attribution.length === 0 ? (
          <EmptyState
            size="sm"
            icon="workflow"
            title="Nothing to pair"
            description="No page moved enough this window to set work beside it."
          />
        ) : (
          <ul className="divide-y divide-border">
            {overview.attribution.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5 sm:px-5"
              >
                <span className="min-w-0 flex-1">
                  <Link
                    href={entry.sourceHref}
                    className="block truncate text-[12.5px] font-medium text-fg transition-colors hover:text-accent"
                    title={entry.workTitle}
                  >
                    {entry.workTitle}
                  </Link>
                  <span className="block truncate text-[11px] text-fg-subtle">
                    {entry.sourceModule} · {entry.outcomeLabel}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <ConfidenceTag confidence={entry.confidence} />
                  <span className="tabular text-[12px] font-semibold text-fg">
                    {entry.association}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <PanelFooter>
          <span>Association, never cause</span>
          <Button variant="ghost" onClick={() => onOpenTab("attribution")}>
            Full shortlist
            <Icon name="arrow-right" className="h-4 w-4" />
          </Button>
        </PanelFooter>
      </Panel>
    </div>
  );
}
