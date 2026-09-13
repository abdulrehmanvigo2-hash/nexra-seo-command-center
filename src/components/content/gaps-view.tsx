"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import { FORMAT_META, GAP_KIND_META, GAP_KIND_ORDER } from "@/lib/mock/content";
import { ListExpander } from "@/components/agents/list-expander";
import {
  ContentLink,
  IntentBadge,
  KeywordLink,
  OwnerLink,
} from "@/components/content/content-chrome";
import type {
  ContentGapKind,
  ContentGapOpportunity,
} from "@/types/content";

/**
 * What is worth commissioning next.
 *
 * The keyword-level findings are the Keyword Intelligence module's own, so a
 * gap counted there is the same gap counted here — this view adds the
 * commissioning decision on top: what format it should be, who owns it, and
 * what it would be worth. The one finding that module cannot report is the
 * structural one: a cluster with no hub page, which no single keyword owns.
 *
 * The controls record a decision in this session and say so. Nothing is
 * queued, assigned, or written anywhere (CLAUDE.md §4).
 */

type GapState = "open" | "planned" | "briefed" | "dismissed";

const STATE_META: Record<
  GapState,
  { readonly label: string; readonly tone: "neutral" | "accent" | "positive" }
> = {
  open: { label: "Open", tone: "neutral" },
  planned: { label: "Added to plan", tone: "accent" },
  briefed: { label: "Brief requested", tone: "positive" },
  dismissed: { label: "Dismissed", tone: "neutral" },
};

const PREVIEW = 12;

export function GapsView({
  gaps,
  states,
  onAct,
}: {
  gaps: readonly ContentGapOpportunity[];
  /** Decisions recorded in this session, by gap id. */
  states: Record<string, GapState>;
  onAct: (id: string, state: GapState) => void;
}) {
  const [kind, setKind] = useState<ContentGapKind | "all">("all");
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: gaps.length };
    for (const gap of gaps) tally[gap.kind] = (tally[gap.kind] ?? 0) + 1;
    return tally;
  }, [gaps]);

  const visible = useMemo(
    () => (kind === "all" ? gaps : gaps.filter((gap) => gap.kind === kind)),
    [gaps, kind],
  );

  const shown = expanded ? visible : visible.slice(0, PREVIEW);

  const totalPotential = visible.reduce(
    (carry, gap) => carry + gap.trafficPotential,
    0,
  );
  const acted = gaps.filter(
    (gap) => (states[gap.id] ?? "open") !== "open",
  ).length;

  return (
    <Panel>
      <div className="border-b border-border px-4 py-3.5 sm:px-5">
        <SectionHeader
          eyebrow="Gaps"
          title="What to commission next"
          description="Queries with nothing behind them, pages too thin to compete, and clusters with no hub."
          actions={
            <Segmented
              label="Filter gaps by kind"
              value={kind}
              onChange={(next) => {
                setKind(next);
                setExpanded(false);
              }}
              options={[
                { value: "all" as const, label: "All", count: counts.all },
                ...GAP_KIND_ORDER.filter(
                  (entry) => (counts[entry] ?? 0) > 0,
                ).map((entry) => ({
                  value: entry,
                  label: GAP_KIND_META[entry].label,
                  count: counts[entry],
                  title: GAP_KIND_META[entry].description,
                })),
              ]}
            />
          }
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon="check"
          title={
            gaps.length === 0
              ? "No content gaps in this selection"
              : "None of this kind"
          }
          description={
            gaps.length === 0
              ? "Every keyword in the current selection has a page behind it, and every cluster has a hub."
              : "No gap in the current selection is of this kind."
          }
          action={
            kind !== "all" ? (
              <Button icon="close" onClick={() => setKind("all")}>
                Show every gap
              </Button>
            ) : undefined
          }
        />
      ) : (
        <PanelBody>
          <ul className="space-y-2">
            {shown.map((gap) => {
              const state = states[gap.id] ?? "open";
              const meta = GAP_KIND_META[gap.kind];

              return (
                <li
                  key={gap.id}
                  className={cn(
                    "rounded-md border px-3.5 py-3 transition-colors",
                    state === "open"
                      ? "border-border bg-surface-raised"
                      : "border-border/70 bg-surface-raised/50",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <Badge tone={meta.tone} title={meta.description}>
                          <Icon name={meta.icon} className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                        <Badge tone="neutral">
                          Write a{" "}
                          {FORMAT_META[gap.suggestedFormat].label.toLowerCase()}
                        </Badge>
                        <IntentBadge intent={gap.intent} />
                        {state !== "open" && (
                          <Badge tone={STATE_META[state].tone}>
                            {STATE_META[state].label}
                          </Badge>
                        )}
                      </p>

                      <h4 className="mt-2 text-[13px] leading-snug font-semibold text-fg">
                        {gap.contentId ? (
                          <ContentLink id={gap.contentId} title={gap.title} />
                        ) : (
                          gap.title
                        )}
                      </h4>

                      <p className="mt-1 text-[12px] leading-relaxed text-fg-subtle">
                        {gap.reason}
                      </p>

                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-subtle">
                        {gap.keywordId !== "" && (
                          <KeywordLink
                            id={gap.keywordId}
                            keyword={gap.keyword}
                            className="text-[11.5px]"
                          />
                        )}
                        <span>{gap.projectName}</span>
                        {gap.clusterId !== "" && (
                          <Link
                            href={`/keywords/clusters/${gap.clusterId}`}
                            className="min-w-0 truncate transition-colors hover:text-accent"
                          >
                            {gap.clusterName}
                          </Link>
                        )}
                        <OwnerLink agent={gap.owner} className="text-[11.5px]" />
                      </p>

                      <dl className="tabular mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-fg-subtle">
                        <span>
                          <dt className="inline">Volume: </dt>
                          <dd className="inline text-fg-muted">
                            {formatCompact(gap.volume)} / mo
                          </dd>
                        </span>
                        <span>
                          <dt className="inline">Difficulty: </dt>
                          <dd className="inline text-fg-muted">
                            {gap.difficulty}
                          </dd>
                        </span>
                        <span>
                          <dt className="inline">Potential: </dt>
                          <dd className="inline text-fg-muted">
                            {formatCompact(gap.trafficPotential)} sessions / mo
                          </dd>
                        </span>
                        {gap.competitor && (
                          <span>
                            <dt className="inline">Held by: </dt>
                            <dd className="inline text-fg-muted">
                              {gap.competitor}
                              {" "}
                              <Link
                                href={`/competitors?project=${gap.projectId}&tab=gaps`}
                                className="text-accent transition-colors hover:text-accent-hover"
                              >
                                see the competitive picture
                              </Link>
                            </dd>
                          </span>
                        )}
                      </dl>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <div className="w-24">
                        <p className="text-right text-[10.5px] text-fg-subtle">
                          Opportunity {gap.opportunityScore}
                        </p>
                        <Meter
                          className="mt-1"
                          size="sm"
                          value={gap.opportunityScore}
                          tone={
                            gap.opportunityScore >= 75
                              ? "positive"
                              : gap.opportunityScore >= 55
                                ? "accent"
                                : "warning"
                          }
                          label={`Opportunity score ${gap.opportunityScore} of 100`}
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {state === "open" ? (
                          <>
                            <Button
                              icon="plus"
                              onClick={() => onAct(gap.id, "planned")}
                            >
                              Add to plan
                            </Button>
                            <Button
                              icon="brief"
                              onClick={() => onAct(gap.id, "briefed")}
                            >
                              Request brief
                            </Button>
                            <Button
                              variant="ghost"
                              icon="close"
                              onClick={() => onAct(gap.id, "dismissed")}
                            >
                              Dismiss
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            icon="refresh"
                            onClick={() => onAct(gap.id, "open")}
                          >
                            Undo
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </PanelBody>
      )}

      <PanelFooter>
        <ListExpander
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
          shown={PREVIEW}
          total={visible.length}
          noun="gaps"
        />
        <span>
          {formatCompact(totalPotential)} sessions / mo behind this queue.{" "}
          {acted} decided in this session — nothing is queued or assigned.
        </span>
      </PanelFooter>
    </Panel>
  );
}
