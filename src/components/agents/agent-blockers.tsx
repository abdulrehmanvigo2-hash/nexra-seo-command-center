"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { ListExpander } from "@/components/agents/list-expander";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import {
  AGENT_NAMES,
  BLOCKER_KIND_META,
  BLOCKER_KIND_ORDER,
  BLOCKER_RESOLUTION_META,
} from "@/lib/mock/agents";
import type {
  AgentBlocker,
  BlockerKind,
  BlockerResolution,
} from "@/types/agent";

/**
 * Everything stopping work, worst first.
 *
 * The operational counterpart to the roster: the roster says who is stuck,
 * this says what they are stuck on and what to do about it. Each row carries
 * one recommended action, because a queue that offers four equal buttons is a
 * queue nobody clears.
 *
 * Acting on a row records a state in this session and nothing else. No agent
 * is retried, reassigned, or dispatched (CLAUDE.md §4).
 */

type Filter = BlockerKind | "all";

/** Rows shown before the queue is expanded, and inside an overview preview. */
const COLLAPSED_ROWS = 6;
const PREVIEW_ROWS = 4;

/** The state each control moves a row into. */
const ACTION_RESULT: Record<string, BlockerResolution> = {
  Retry: "retrying",
  Reassign: "reassigned",
  "Mark reviewed": "reviewed",
  Resolve: "resolved",
};

export function AgentBlockers({
  blockers,
  resolutions,
  onResolve,
  referenceIso,
  preview = false,
  onViewAll,
  title = "Blockers & Review Queue",
  description = "Stopped work, failed hand-offs, and decisions the team is waiting on.",
}: {
  blockers: readonly AgentBlocker[];
  resolutions: Readonly<Record<string, BlockerResolution>>;
  onResolve: (id: string, resolution: BlockerResolution) => void;
  referenceIso: string;
  preview?: boolean;
  onViewAll?: () => void;
  title?: string;
  description?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: blockers.length };
    for (const blocker of blockers) {
      tally[blocker.kind] = (tally[blocker.kind] ?? 0) + 1;
    }
    return tally;
  }, [blockers]);

  const open = blockers.filter(
    (blocker) => (resolutions[blocker.id] ?? "open") === "open",
  ).length;

  const critical = blockers.filter(
    (blocker) =>
      blocker.severity === "critical" &&
      (resolutions[blocker.id] ?? "open") === "open",
  ).length;

  const matching =
    filter === "all"
      ? blockers
      : blockers.filter((blocker) => blocker.kind === filter);

  // Sorted worst-first, so the collapsed view is always the part that matters.
  const limit = preview ? PREVIEW_ROWS : expanded ? matching.length : COLLAPSED_ROWS;
  const visible = matching.slice(0, limit);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Operations"
        title={title}
        description={description}
        actions={
          <Badge tone={critical > 0 ? "critical" : open > 0 ? "warning" : "positive"} dot>
            {open} open{critical > 0 ? ` · ${critical} critical` : ""}
          </Badge>
        }
      />

      {!preview && blockers.length > 0 && (
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <Segmented
            label="Filter the queue by cause"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all" as const, label: "All", count: counts.all },
              ...BLOCKER_KIND_ORDER.filter(
                (kind) => (counts[kind] ?? 0) > 0,
              ).map((kind) => ({
                value: kind,
                label: BLOCKER_KIND_META[kind].label,
                count: counts[kind],
              })),
            ]}
          />
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon="check"
          title={
            blockers.length === 0 ? "Nothing is blocked" : "Nothing of this kind"
          }
          description={
            blockers.length === 0
              ? "No stopped work, no failed hand-offs, and no reviews waiting. The pipeline is clear."
              : "No items of this kind are in the queue right now."
          }
        />
      ) : (
        <PanelBody className="space-y-2.5">
          {visible.map((blocker) => (
            <BlockerRow
              key={blocker.id}
              blocker={blocker}
              resolution={resolutions[blocker.id] ?? "open"}
              onResolve={onResolve}
              referenceIso={referenceIso}
              compact={preview}
            />
          ))}
        </PanelBody>
      )}

      <PanelFooter className="mt-auto">
        <span>
          {blockers.length - open} of {blockers.length} actioned in this session
        </span>
        {preview && onViewAll ? (
          <Button variant="ghost" onClick={onViewAll}>
            View the whole queue
            <Icon name="arrow-right" className="h-4 w-4" />
          </Button>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Actions are held in this session only.</span>
            <ListExpander
              expanded={expanded}
              onToggle={() => setExpanded((open) => !open)}
              shown={COLLAPSED_ROWS}
              total={matching.length}
              noun="items"
            />
          </span>
        )}
      </PanelFooter>
    </Panel>
  );
}

function BlockerRow({
  blocker,
  resolution,
  onResolve,
  referenceIso,
  compact,
}: {
  blocker: AgentBlocker;
  resolution: BlockerResolution;
  onResolve: (id: string, resolution: BlockerResolution) => void;
  referenceIso: string;
  compact: boolean;
}) {
  const kind = BLOCKER_KIND_META[blocker.kind];
  const state = BLOCKER_RESOLUTION_META[resolution];
  const done = resolution !== "open";

  return (
    <article
      className={cn(
        "rounded-md border border-l-2 border-border bg-surface-raised px-3.5 py-3 transition-colors",
        blocker.severity === "critical" ? "border-l-critical" : "border-l-warning",
        done && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={kind.tone}>
            <Icon name={kind.icon} className="h-3 w-3" />
            {kind.label}
          </Badge>
          <PriorityBadge priority={blocker.severity} />
          {done && (
            <Badge tone={state.tone} dot>
              {state.label}
            </Badge>
          )}
        </div>

        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] whitespace-nowrap text-fg-subtle">
          <Icon name="clock" className="h-3.5 w-3.5" />
          {formatRelative(blocker.since, referenceIso)}
        </span>
      </div>

      <p
        className={cn(
          "mt-2 text-[12.5px] leading-snug text-fg",
          done && "line-through",
        )}
      >
        {blocker.issue}
      </p>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-subtle">
        <Link
          href={`/agents/${blocker.agent}`}
          className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
        >
          <Icon name="agents" className="h-3.5 w-3.5" />
          {AGENT_NAMES[blocker.agent]}
        </Link>
        <Link
          href={`/projects/${blocker.projectId}`}
          className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
        >
          <Icon name="projects" className="h-3.5 w-3.5" />
          {blocker.projectName}
        </Link>
      </p>

      {!compact && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-2.5">
          <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-fg-muted">
            <span className="font-medium text-fg-subtle">Next: </span>
            {blocker.recommendedAction}
          </p>

          {done ? (
            <Button
              variant="ghost"
              icon="refresh"
              onClick={() => onResolve(blocker.id, "open")}
            >
              Reopen
            </Button>
          ) : (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  onResolve(
                    blocker.id,
                    ACTION_RESULT[blocker.actionLabel] ?? "resolved",
                  )
                }
              >
                {blocker.actionLabel}
              </Button>
              <Button
                variant="ghost"
                icon="check"
                onClick={() => onResolve(blocker.id, "resolved")}
              >
                Resolve
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
