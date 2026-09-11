"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import { GAP_KIND_META, GAP_KIND_ORDER } from "@/lib/mock/competitors";
import {
  CompetitorLink,
  CompetitorPageUrl,
  GapKindBadge,
  OwnerLink,
  PositionValue,
  TrafficValue,
} from "@/components/competitors/competitor-chrome";
import type { CompetitorGap, CompetitorGapKind } from "@/types/competitor";

/**
 * Where a rival covers something we do not.
 *
 * Eight kinds, filtered by a strip that only offers kinds the selection
 * actually contains. Each finding states the evidence, the fix, and who would
 * own it, and links to the three places the fix happens: the keyword, the
 * cluster, and the page in the Content Studio.
 *
 * The connection to Phase 6 is the point of the view. A competitive gap that
 * does not resolve to a page to write or refresh is an observation; one that
 * opens the brief is work.
 */
export function GapsView({
  gaps,
  kindFilter,
  onKindFilter,
  states,
  onAct,
}: {
  gaps: readonly CompetitorGap[];
  kindFilter: CompetitorGapKind | "all";
  onKindFilter: (kind: CompetitorGapKind | "all") => void;
  /** Session-only decisions recorded against a finding. */
  states: Readonly<Record<string, GapState>>;
  onAct: (id: string, state: GapState) => void;
}) {
  const counts = new Map<CompetitorGapKind, number>();
  for (const kind of GAP_KIND_ORDER) {
    counts.set(kind, gaps.filter((gap) => gap.kind === kind).length);
  }

  const shown =
    kindFilter === "all" ? gaps : gaps.filter((gap) => gap.kind === kindFilter);

  const available = GAP_KIND_ORDER.filter(
    (kind) => (counts.get(kind) ?? 0) > 0,
  );

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Coverage"
          title="What they cover and we do not"
          description={`${gaps.length} findings across this selection, most valuable first. Only kinds present in the selection are offered.`}
          actions={
            kindFilter !== "all" ? (
              <Button icon="close" onClick={() => onKindFilter("all")}>
                Show every kind
              </Button>
            ) : undefined
          }
        />
        <PanelBody>
          {available.length === 0 ? (
            <p className="py-4 text-center text-[12.5px] text-fg-subtle">
              No gaps in this selection.
            </p>
          ) : (
            <div
              role="group"
              aria-label="Filter gaps by kind"
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
            >
              {available.map((kind) => {
                const meta = GAP_KIND_META[kind];
                const active = kindFilter === kind;

                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onKindFilter(active ? "all" : kind)}
                    title={meta.description}
                    className={cn(
                      "rounded-md border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-accent/50 bg-accent-soft"
                        : "border-border bg-surface-raised hover:border-border-strong hover:bg-surface-hover",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg-muted">
                      <Icon
                        name={meta.icon}
                        className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                      />
                      <span className="truncate">{meta.label}</span>
                    </span>
                    <span className="tabular mt-1.5 block text-[19px] leading-none font-semibold text-fg">
                      {counts.get(kind)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </PanelBody>
        <PanelFooter>
          <span>
            A term produces at most one gap per rival — the most serious kind
            that applies — so the counts above add up to the total.
          </span>
          <span>
            {formatCompact(
              gaps.reduce((carry, gap) => carry + gap.value, 0),
            )}{" "}
            sessions / mo behind them
          </span>
        </PanelFooter>
      </Panel>

      {shown.length === 0 ? (
        <Panel>
          <EmptyState
            icon="search"
            title="No gaps of that kind here"
            description="Nothing in the current selection matches. Pick another kind, or widen the filters above."
            action={
              kindFilter !== "all" ? (
                <Button icon="close" onClick={() => onKindFilter("all")}>
                  Show every kind
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <ul className="space-y-3">
          {shown.map((gap) => {
            const state = states[gap.id] ?? "open";

            return (
              <li key={gap.id}>
                <Panel as="article" className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <GapKindBadge kind={gap.kind} />
                        <PriorityBadge priority={gap.severity} />
                        <span className="tabular text-[11px] text-fg-subtle">
                          Score {gap.score}
                        </span>
                      </div>

                      <p className="mt-2.5 text-[13px] leading-snug font-medium text-fg">
                        {gap.finding}
                      </p>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-fg-muted">
                        {gap.action}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <TrafficValue sessions={gap.value} />
                      <span className="text-[10.5px] text-fg-subtle">
                        sessions / mo
                      </span>
                    </div>
                  </div>

                  <dl className="mt-3.5 grid gap-x-5 gap-y-2 border-t border-border pt-3 text-[11.5px] sm:grid-cols-2 lg:grid-cols-4">
                    <Fact label="Competitor">
                      <CompetitorLink
                        id={gap.competitorId}
                        name={gap.competitorName}
                        className="text-[11.5px] font-normal text-fg-muted"
                      />
                    </Fact>

                    <Fact label="Keyword">
                      {gap.keywordId === null ? (
                        <span className="text-fg-subtle">
                          Whole cluster — no single term
                        </span>
                      ) : (
                        <Link
                          href={`/keywords/${gap.keywordId}`}
                          className="truncate text-fg-muted transition-colors hover:text-accent"
                        >
                          {gap.keyword}
                        </Link>
                      )}
                    </Fact>

                    <Fact label="Cluster">
                      <Link
                        href={`/keywords/clusters/${gap.clusterId}`}
                        className="truncate text-fg-muted transition-colors hover:text-accent"
                      >
                        {gap.clusterName}
                      </Link>
                    </Fact>

                    <Fact label="Positions">
                      <span className="tabular inline-flex items-center gap-1.5 text-fg-muted">
                        ours <PositionValue position={gap.ourPosition} />
                        <span className="text-fg-subtle">·</span>
                        theirs <PositionValue position={gap.theirPosition} />
                      </span>
                    </Fact>

                    <Fact label="Our page">
                      {gap.ourContentId === null ? (
                        <span className="text-warning">Nothing of ours</span>
                      ) : (
                        <Link
                          href={`/content/${gap.ourContentId}`}
                          className="truncate font-mono text-[11px] text-fg-subtle transition-colors hover:text-accent"
                        >
                          {gap.ourUrl ?? "Planned, not published"}
                        </Link>
                      )}
                    </Fact>

                    <Fact label="Their page">
                      {gap.theirUrl === null ? (
                        <span className="text-fg-subtle">—</span>
                      ) : (
                        <CompetitorPageUrl url={gap.theirUrl} />
                      )}
                    </Fact>

                    <Fact label="Owner">
                      <OwnerLink agent={gap.owner} className="text-[11.5px]" />
                    </Fact>

                    <Fact label="Project">
                      <Link
                        href={`/projects/${gap.projectId}`}
                        className="truncate text-fg-muted transition-colors hover:text-accent"
                      >
                        {gap.projectName}
                      </Link>
                    </Fact>
                  </dl>

                  <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {GAP_STATES.map((option) => (
                      <Button
                        key={option.value}
                        size="sm"
                        variant={state === option.value ? "primary" : "secondary"}
                        aria-pressed={state === option.value}
                        onClick={() => onAct(gap.id, option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}

                    {gap.ourContentId !== null && (
                      <Link
                        href={`/content/${gap.ourContentId}`}
                        className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-accent transition-colors hover:text-accent-hover"
                      >
                        Open in Content Studio
                        <Icon name="arrow-right" className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>

                  {state !== "open" && (
                    <p className="mt-2 text-[11px] text-fg-subtle">
                      Recorded in this session only — nothing was briefed,
                      assigned, or published.
                    </p>
                  )}
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export type GapState = "open" | "planned" | "briefed" | "dismissed";

const GAP_STATES: readonly {
  readonly value: GapState;
  readonly label: string;
}[] = [
  { value: "planned", label: "Plan it" },
  { value: "briefed", label: "Brief it" },
  { value: "dismissed", label: "Not worth it" },
  { value: "open", label: "Reset" },
];

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-medium tracking-[0.04em] text-fg-subtle uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 min-w-0 truncate">{children}</dd>
    </div>
  );
}
