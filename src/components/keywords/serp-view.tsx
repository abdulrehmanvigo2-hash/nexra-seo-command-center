"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import {
  SERP_FEATURE_META,
  SERP_OWNERSHIP_META,
  type SerpFeatureSummary,
} from "@/lib/mock/keywords";

/**
 * What the result pages behind the selection look like.
 *
 * Ownership is the point of the view, so every feature is split three ways:
 * held by us, held by a rival, or unclaimed. A feature nobody holds is the
 * cheapest thing on the page to win, which is why the list is ordered by the
 * demand sitting behind the instances we do not hold rather than by how often
 * the feature appears.
 *
 * The recommended action on each row is the action attached to the highest
 * volume instance we do not hold — advice from a real keyword, not a template.
 */
export function SerpView({
  summaries,
  total,
}: {
  summaries: readonly SerpFeatureSummary[];
  /** Size of the selection the roll-up describes. */
  total: number;
}) {
  const openVolume = summaries.reduce(
    (carry, entry) => carry + entry.openVolume,
    0,
  );

  return (
    <Panel>
      <PanelHeader
        eyebrow="SERP intelligence"
        title="Result page features"
        description="Which features appear on the result pages for this selection, who holds them, and what it would take to take one."
        actions={
          <Badge tone="accent">
            {formatCompact(openVolume)} searches / mo behind features we do not
            hold
          </Badge>
        }
      />

      {summaries.length === 0 ? (
        <EmptyState
          icon="search"
          title="No SERP features detected"
          description="The result pages for this selection are plain organic listings with no extra blocks on them."
        />
      ) : (
        <PanelBody className="space-y-2.5">
          {summaries.map((summary) => {
            const meta = SERP_FEATURE_META[summary.feature];
            const held = summary.ours;
            const open = summary.competitor + summary.unclaimed;

            return (
              <article
                key={summary.feature}
                className="rounded-md border border-border bg-surface-raised px-3.5 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface text-fg-muted">
                      <Icon name={meta.icon} className="h-4 w-4" />
                    </span>

                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[13px] font-semibold text-fg">
                          {meta.label}
                        </span>
                        <Badge
                          tone={
                            summary.opportunity === "high"
                              ? "warning"
                              : summary.opportunity === "medium"
                                ? "accent"
                                : "neutral"
                          }
                        >
                          {summary.opportunity} opportunity
                        </Badge>
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-fg-subtle">
                        {meta.description}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="tabular text-[16px] leading-none font-semibold text-fg">
                      {summary.total}
                    </p>
                    <p className="mt-1 text-[11px] text-fg-subtle">
                      of {total} keywords ({summary.share}%)
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                  <div>
                    <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-surface-hover">
                      <Segment value={summary.ours} total={summary.total} className="bg-positive" />
                      <Segment
                        value={summary.competitor}
                        total={summary.total}
                        className="bg-warning"
                      />
                      <Segment
                        value={summary.unclaimed}
                        total={summary.total}
                        className="bg-fg-subtle"
                      />
                    </div>

                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
                      <Legend
                        dot="bg-positive"
                        label={SERP_OWNERSHIP_META.ours.label}
                        count={summary.ours}
                      />
                      <Legend
                        dot="bg-warning"
                        label={SERP_OWNERSHIP_META.competitor.label}
                        count={summary.competitor}
                      />
                      <Legend
                        dot="bg-fg-subtle"
                        label={SERP_OWNERSHIP_META.unclaimed.label}
                        count={summary.unclaimed}
                      />
                    </ul>

                    <div className="mt-2.5">
                      <div className="flex items-baseline justify-between text-[11px] text-fg-subtle">
                        <span>Share we hold</span>
                        <span className="tabular">
                          {summary.total === 0
                            ? 0
                            : Math.round((held / summary.total) * 100)}
                          %
                        </span>
                      </div>
                      <Meter
                        className="mt-1"
                        size="sm"
                        value={held}
                        max={Math.max(summary.total, 1)}
                        tone={held > open ? "positive" : "warning"}
                        label={`We hold ${held} of ${summary.total} ${meta.label} instances`}
                      />
                    </div>
                  </div>

                  <div className="min-w-0">
                    <p className="flex items-start gap-2 text-[12px] leading-relaxed text-fg-muted">
                      <Icon
                        name="target"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle"
                      />
                      {summary.action}
                    </p>

                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {summary.examples.map((example) => (
                        <li key={example.id}>
                          <Link
                            href={`/keywords/${example.id}`}
                            title={`${example.projectName} · ${formatCompact(example.volume)} searches / mo · ${example.ownership === "ours" ? "held by us" : example.ownership === "competitor" ? "held by a rival" : "unclaimed"}`}
                            className={cn(
                              "inline-flex max-w-[220px] items-center gap-1.5 rounded border px-2 py-1 text-[11.5px] transition-colors",
                              example.ownership === "ours"
                                ? "border-positive/30 bg-positive/5 text-fg-muted hover:border-positive/60"
                                : "border-border bg-surface text-fg-muted hover:border-border-strong",
                            )}
                          >
                            <span className="truncate">{example.keyword}</span>
                            <span className="tabular shrink-0 text-fg-subtle">
                              {formatCompact(example.volume)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            );
          })}
        </PanelBody>
      )}

      <PanelFooter>
        <span>
          Features are detected per keyword and rolled up here — opening any
          keyword shows the same features on its own SERP panel.
        </span>
      </PanelFooter>
    </Panel>
  );
}

function Segment({
  value,
  total,
  className,
}: {
  value: number;
  total: number;
  className: string;
}) {
  if (value === 0) return null;
  return (
    <div
      className={cn("h-full first:rounded-l-full last:rounded-r-full", className)}
      style={{ width: `${(value / Math.max(total, 1)) * 100}%` }}
    />
  );
}

function Legend({
  dot,
  label,
  count,
}: {
  dot: string;
  label: string;
  count: number;
}) {
  return (
    <li className="flex items-center gap-1.5 text-fg-subtle">
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
      <span className="tabular font-medium text-fg-muted">{count}</span>
    </li>
  );
}
