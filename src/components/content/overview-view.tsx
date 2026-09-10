"use client";

import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCompact, formatShortDate } from "@/lib/format";
import { HEALTH_META, STAGE_META } from "@/lib/mock/content";
import {
  ContentLink,
  FormatBadge,
  HealthBadge,
  OwnerLink,
  PageUrl,
  ScoreValue,
} from "@/components/content/content-chrome";
import type {
  ContentGapOpportunity,
  ContentRecord,
  WorkflowColumn,
} from "@/types/content";

/**
 * The Content Studio at a glance.
 *
 * Four questions, in the order an editor asks them on a Monday: what is in
 * flight, what is falling over, what is worth writing next, and what shipped.
 * Everything here is a link into the view that answers it properly — the
 * overview is a starting point, not a place to work.
 */
export function OverviewView({
  board,
  attention,
  gaps,
  recent,
  onOpenTab,
}: {
  board: readonly WorkflowColumn[];
  /** Live pages in a state that needs somebody. */
  attention: readonly ContentRecord[];
  gaps: readonly ContentGapOpportunity[];
  /** Pieces published inside the recent window. */
  recent: readonly ContentRecord[];
  onOpenTab: (tab: "pipeline" | "inventory" | "gaps") => void;
}) {
  const inFlight = board
    .filter((column) => column.stage !== "published")
    .reduce((carry, column) => carry + column.items.length, 0);

  const maxColumn = Math.max(
    1,
    ...board
      .filter((column) => column.stage !== "published")
      .map((column) => column.items.length),
  );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel>
        <PanelHeader
          eyebrow="Pipeline"
          title="What is in flight"
          description="New pieces and queued refreshes, by the stage they have reached."
          actions={
            <Button icon="workflow" onClick={() => onOpenTab("pipeline")}>
              Open the board
            </Button>
          }
        />

        {inFlight === 0 ? (
          <EmptyState
            icon="workflow"
            size="sm"
            title="Nothing in production"
            description="No piece in the current selection has work against it."
            action={
              <Button icon="target" onClick={() => onOpenTab("gaps")}>
                Find something to commission
              </Button>
            }
          />
        ) : (
          <PanelBody>
            <ul className="space-y-2">
              {board
                .filter((column) => column.stage !== "published")
                .map((column) => (
                  <li key={column.stage}>
                    <div className="flex items-baseline justify-between gap-3 text-[12px]">
                      <span className="inline-flex items-center gap-1.5 text-fg-muted">
                        <Icon
                          name={STAGE_META[column.stage].icon}
                          className="h-3.5 w-3.5 text-fg-subtle"
                        />
                        {column.label}
                      </span>
                      <span className="tabular flex items-baseline gap-2">
                        <span className="text-[13px] font-semibold text-fg">
                          {column.items.length}
                        </span>
                        {column.volume > 0 && (
                          <span className="text-[11px] text-fg-subtle">
                            {formatCompact(column.volume)} / mo
                          </span>
                        )}
                      </span>
                    </div>
                    <Meter
                      className="mt-1"
                      size="sm"
                      value={(column.items.length / maxColumn) * 100}
                      tone={
                        column.stage === "review"
                          ? "warning"
                          : column.stage === "approved" ||
                              column.stage === "scheduled"
                            ? "positive"
                            : "accent"
                      }
                      label={`${column.label}: ${column.items.length} items`}
                    />
                  </li>
                ))}
            </ul>
          </PanelBody>
        )}

        <PanelFooter>
          <span>{inFlight} items in production.</span>
          <span>The bar is each stage against the busiest one.</span>
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Attention"
          title="What is falling over"
          description="Live pages that are decaying, thin, unmeasured, or invisible."
          actions={
            <Button icon="filter" onClick={() => onOpenTab("inventory")}>
              Open the inventory
            </Button>
          }
        />

        {attention.length === 0 ? (
          <EmptyState
            icon="check"
            size="sm"
            title="Nothing needs attention"
            description="Every live page in the current selection is holding its own."
          />
        ) : (
          <PanelBody>
            <ul className="space-y-2">
              {attention.slice(0, 6).map((record) => (
                <li
                  key={record.id}
                  className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-raised px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <ContentLink
                      id={record.id}
                      title={record.title}
                      className="block truncate text-[12.5px]"
                    />
                    <span className="mt-0.5 block truncate text-[11px] text-fg-subtle">
                      {record.refresh
                        ? record.refresh.reason
                        : HEALTH_META[record.health].description}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <HealthBadge health={record.health} />
                    <ScoreValue
                      score={record.score.score}
                      published
                      showMeter={false}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </PanelBody>
        )}

        <PanelFooter>
          <span>
            {attention.length} live{" "}
            {attention.length === 1 ? "page needs" : "pages need"} work.
          </span>
          {attention.length > 6 && (
            <span>Showing the six worth doing first.</span>
          )}
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Commissioning"
          title="Worth writing next"
          description="The highest-scoring gaps in the current selection."
          actions={
            <Button icon="target" onClick={() => onOpenTab("gaps")}>
              Open the queue
            </Button>
          }
        />

        {gaps.length === 0 ? (
          <EmptyState
            icon="check"
            size="sm"
            title="No gaps to fill"
            description="Every keyword in the current selection has a page behind it."
          />
        ) : (
          <PanelBody>
            <ul className="space-y-2">
              {gaps.slice(0, 6).map((gap) => (
                <li
                  key={gap.id}
                  className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-raised px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-fg">
                      {gap.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-fg-subtle">
                      {gap.keyword} · {formatCompact(gap.volume)} / mo ·{" "}
                      {gap.projectName}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone="neutral">{gap.opportunityScore}</Badge>
                    <OwnerLink agent={gap.owner} className="text-[11px]" />
                  </span>
                </li>
              ))}
            </ul>
          </PanelBody>
        )}

        <PanelFooter>
          <span>{gaps.length} gaps in this selection.</span>
          <span>
            {formatCompact(
              gaps.reduce((carry, gap) => carry + gap.trafficPotential, 0),
            )}{" "}
            sessions / mo behind them.
          </span>
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Shipped"
          title="Recently published"
          description="What has gone live, and how it is doing so far."
        />

        {recent.length === 0 ? (
          <EmptyState
            icon="calendar"
            size="sm"
            title="Nothing published recently"
            description="No page in the current selection went live in the last ninety days."
          />
        ) : (
          <PanelBody>
            <ul className="space-y-2">
              {recent.slice(0, 6).map((record) => (
                <li
                  key={record.id}
                  className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-raised px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <ContentLink
                      id={record.id}
                      title={record.title}
                      className="block truncate text-[12.5px]"
                    />
                    <PageUrl url={record.url} className="mt-0.5" />
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <FormatBadge format={record.format} />
                    {record.publishedAt && (
                      <span className="tabular text-[11px] whitespace-nowrap text-fg-subtle">
                        {formatShortDate(record.publishedAt)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </PanelBody>
        )}

        <PanelFooter>
          <span>
            {recent.length} published in the last ninety days in this selection.
          </span>
          <Link
            href="/keywords"
            className={cn(
              buttonClasses("ghost", "sm"),
              "text-[12px] text-fg-subtle",
            )}
          >
            See what they rank for
            <Icon name="arrow-right" className="h-3.5 w-3.5" />
          </Link>
        </PanelFooter>
      </Panel>
    </div>
  );
}
