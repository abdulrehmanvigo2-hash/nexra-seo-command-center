"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents";
import {
  OPPORTUNITY_KIND_META,
  OPPORTUNITY_KIND_ORDER,
} from "@/lib/mock/competitors";
import {
  CompetitorLink,
  CompetitorPageUrl,
  IntentBadge,
  OpportunityKindBadge,
  OwnerLink,
  TrafficValue,
} from "@/components/competitors/competitor-chrome";
import { Pagination } from "@/components/keywords/pagination";
import type {
  CompetitorOpportunity,
  Level,
  OpportunityKind,
} from "@/types/competitor";

/**
 * The work the analysis produces.
 *
 * Competitor Intelligence that stops at observation leaves the hard part to
 * somebody else. Every row here is traceable to a finding above it and carries
 * the four things a decision needs: what it is worth, what it would take, how
 * confident the reading is, and who would own it.
 *
 * The controls record a decision in session state and say so. Nothing here
 * commissions a page, assigns an agent, or touches anything outside this tab —
 * the agents are mocked in this milestone (CLAUDE.md §13).
 */
export function OpportunitiesView({
  opportunities,
  kindFilter,
  onKindFilter,
  states,
  onAct,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  opportunities: readonly CompetitorOpportunity[];
  kindFilter: OpportunityKind | "all";
  onKindFilter: (kind: OpportunityKind | "all") => void;
  states: Readonly<Record<string, OpportunityState>>;
  onAct: (id: string, state: OpportunityState) => void;
  page: number;
  pageSize: number;
  onPageChange: (value: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const counts = new Map<OpportunityKind, number>();
  for (const kind of OPPORTUNITY_KIND_ORDER) {
    counts.set(
      kind,
      opportunities.filter((entry) => entry.kind === kind).length,
    );
  }

  const available = OPPORTUNITY_KIND_ORDER.filter(
    (kind) => (counts.get(kind) ?? 0) > 0,
  );

  const shown =
    kindFilter === "all"
      ? opportunities
      : opportunities.filter((entry) => entry.kind === kindFilter);

  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = shown.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const value = opportunities.reduce((carry, entry) => carry + entry.value, 0);

  // Who the queue would land on, so the load is visible before it is assigned.
  const byOwner = new Map<string, number>();
  for (const entry of opportunities) {
    byOwner.set(entry.owner, (byOwner.get(entry.owner) ?? 0) + 1);
  }

  if (opportunities.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="target"
          title="No opportunities in this selection"
          description="Nothing in the current filters produces a piece of work. Widen the project or competitor filter."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Queue"
          title="What to do about all of it"
          description={`${opportunities.length} pieces of work, highest value first. About ${formatCompact(value)} monthly sessions across them.`}
          actions={
            kindFilter !== "all" ? (
              <Button icon="close" onClick={() => onKindFilter("all")}>
                Show every kind
              </Button>
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          <div
            role="group"
            aria-label="Filter opportunities by kind"
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
          >
            {available.map((kind) => {
              const meta = OPPORTUNITY_KIND_META[kind];
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

          <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <p className="text-[11px] font-medium tracking-[0.04em] text-fg-subtle uppercase">
              Where the queue lands
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {[...byOwner.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([owner, count]) => (
                  <li
                    key={owner}
                    className="flex items-center gap-1.5 text-[11.5px] text-fg-muted"
                  >
                    <Icon
                      name="agents"
                      className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                    />
                    {AGENT_NAMES[owner as keyof typeof AGENT_NAMES]}
                    <span className="tabular font-semibold text-fg">
                      {count}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        </PanelBody>
        <PanelFooter>
          <span>
            A term produces one piece of work per rival, so a page that is both
            thin and stale is one job rather than two.
          </span>
          <span>Session-only — nothing is commissioned or assigned</span>
        </PanelFooter>
      </Panel>

      {rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon="search"
            title="No work of that kind here"
            description="Pick another kind, or clear the filter to see the whole queue."
            action={
              <Button icon="close" onClick={() => onKindFilter("all")}>
                Show every kind
              </Button>
            }
          />
        </Panel>
      ) : (
        <Panel>
          <ul className="divide-y divide-border">
            {rows.map((entry) => {
              const state = states[entry.id] ?? "open";

              return (
                <li key={entry.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <OpportunityKindBadge kind={entry.kind} />
                        <PriorityBadge priority={entry.priority} />
                        <IntentBadge intent={entry.intent} short />
                        <EffortBadge difficulty={entry.difficulty} />
                      </div>

                      <p className="mt-2.5 text-[13px] leading-snug font-medium text-fg">
                        {entry.action}
                      </p>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-fg-muted">
                        {entry.rationale}
                      </p>
                    </div>

                    <div className="flex w-full shrink-0 flex-col gap-2 sm:w-44">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10.5px] text-fg-subtle">
                          Value
                        </span>
                        <TrafficValue sessions={entry.value} />
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10.5px] text-fg-subtle">
                          Score
                        </span>
                        <span className="tabular text-[12.5px] font-semibold text-fg">
                          {entry.score}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10.5px] text-fg-subtle">
                            Confidence
                          </span>
                          <span className="tabular text-[11.5px] text-fg-muted">
                            {entry.confidence}%
                          </span>
                        </div>
                        <Meter
                          className="mt-1"
                          size="sm"
                          value={entry.confidence}
                          tone={
                            entry.confidence >= 70
                              ? "positive"
                              : entry.confidence >= 45
                                ? "accent"
                                : "warning"
                          }
                          label={`Confidence ${entry.confidence} of 100`}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px]">
                    <CompetitorLink
                      id={entry.competitorId}
                      name={entry.competitorName}
                      className="text-[11.5px] font-normal text-fg-muted"
                    />

                    <Link
                      href={`/projects/${entry.projectId}`}
                      className="text-fg-muted transition-colors hover:text-accent"
                    >
                      {entry.projectName}
                    </Link>

                    {entry.keywordId !== null && (
                      <Link
                        href={`/keywords/${entry.keywordId}`}
                        className="inline-flex items-center gap-1.5 text-fg-muted transition-colors hover:text-accent"
                      >
                        <Icon
                          name="keywords"
                          className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                        />
                        {entry.keyword}
                      </Link>
                    )}

                    {entry.clusterId !== null && (
                      <Link
                        href={`/keywords/clusters/${entry.clusterId}`}
                        className="inline-flex items-center gap-1.5 text-fg-muted transition-colors hover:text-accent"
                      >
                        <Icon
                          name="layers"
                          className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                        />
                        {entry.clusterName}
                      </Link>
                    )}

                    {entry.contentId !== null && (
                      <Link
                        href={`/content/${entry.contentId}`}
                        className="inline-flex items-center gap-1.5 text-fg-muted transition-colors hover:text-accent"
                      >
                        <Icon
                          name="content"
                          className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                        />
                        {entry.url ?? "Planned page"}
                      </Link>
                    )}

                    {entry.theirUrl !== null && (
                      <span className="min-w-0 max-w-[200px]">
                        <CompetitorPageUrl url={entry.theirUrl} />
                      </span>
                    )}

                    <OwnerLink agent={entry.owner} className="text-[11.5px]" />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {OPPORTUNITY_STATES.map((option) => (
                      <Button
                        key={option.value}
                        size="sm"
                        variant={state === option.value ? "primary" : "secondary"}
                        aria-pressed={state === option.value}
                        onClick={() => onAct(entry.id, option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                    {state !== "open" && (
                      <span className="text-[11px] text-fg-subtle">
                        Session state only — nothing was scheduled or assigned.
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <Pagination
            page={currentPage}
            pageSize={pageSize}
            total={shown.length}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            noun="opportunities"
          />
        </Panel>
      )}
    </div>
  );
}

export type OpportunityState = "open" | "queued" | "in-plan" | "dismissed";

const OPPORTUNITY_STATES: readonly {
  readonly value: OpportunityState;
  readonly label: string;
}[] = [
  { value: "queued", label: "Queue it" },
  { value: "in-plan", label: "Add to plan" },
  { value: "dismissed", label: "Not now" },
  { value: "open", label: "Reset" },
];

function EffortBadge({ difficulty }: { difficulty: Level }) {
  const tone =
    difficulty === "high"
      ? "critical"
      : difficulty === "medium"
        ? "warning"
        : "positive";
  const label =
    difficulty === "high"
      ? "Hard"
      : difficulty === "medium"
        ? "Moderate"
        : "Quick";

  return (
    <Badge
      tone={tone}
      title="How much work this would take, from the term's own difficulty and the state of the ranking."
    >
      {label}
    </Badge>
  );
}
