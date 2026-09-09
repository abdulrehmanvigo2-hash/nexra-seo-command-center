"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { ListExpander } from "@/components/agents/list-expander";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import {
  AGENT_NAMES,
  HANDOFF_STATUS_META,
  HANDOFF_STATUS_ORDER,
} from "@/lib/mock/agents";
import { AGENT_REGISTRY } from "@/lib/mock/agents";
import type { AgentHandoff, AgentId, HandoffStatus } from "@/types/agent";

/**
 * Work moving between agents.
 *
 * The panel that makes the team read as a pipeline rather than as twelve
 * separate workers: every row is a finished piece of work, who produced it,
 * who it is going to, and whether it got there.
 *
 * Moving a handoff is frontend state over the fixture. Nothing is transferred,
 * retried, or dispatched (CLAUDE.md §4).
 */

type Filter = HandoffStatus | "all";

/** Rows shown before the queue is expanded, and inside an overview preview. */
const COLLAPSED_ROWS = 6;
const PREVIEW_ROWS = 4;

const INITIALS: Record<string, string> = Object.fromEntries(
  AGENT_REGISTRY.map((agent) => [agent.id, agent.initials]),
);

export function AgentHandoffs({
  handoffs,
  statuses,
  onStatusChange,
  referenceIso,
  preview = false,
  onViewAll,
  title = "Agent Handoffs",
  description = "Finished work moving from one stage of the pipeline to the next.",
}: {
  handoffs: readonly AgentHandoff[];
  statuses: Readonly<Record<string, HandoffStatus>>;
  onStatusChange: (id: string, status: HandoffStatus) => void;
  referenceIso: string;
  preview?: boolean;
  onViewAll?: () => void;
  title?: string;
  description?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);

  const resolved = useMemo(
    () =>
      handoffs.map((handoff) => ({
        ...handoff,
        status: statuses[handoff.id] ?? handoff.status,
      })),
    [handoffs, statuses],
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: resolved.length };
    for (const handoff of resolved) {
      tally[handoff.status] = (tally[handoff.status] ?? 0) + 1;
    }
    return tally;
  }, [resolved]);

  const open = resolved.filter(
    (handoff) => handoff.status !== "accepted",
  ).length;

  const matching =
    filter === "all"
      ? resolved
      : resolved.filter((handoff) => handoff.status === filter);

  // Sorted worst-first, so the collapsed view is the part still to be cleared.
  const limit = preview ? PREVIEW_ROWS : expanded ? matching.length : COLLAPSED_ROWS;
  const visible = matching.slice(0, limit);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Pipeline"
        title={title}
        description={description}
        actions={
          <Badge tone={open > 0 ? "warning" : "positive"} dot>
            {open} still to clear
          </Badge>
        }
      />

      {!preview && (
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <Segmented
            label="Filter handoffs by status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all" as const, label: "All", count: counts.all },
              ...HANDOFF_STATUS_ORDER.map((status) => ({
                value: status,
                label: HANDOFF_STATUS_META[status].label,
                count: counts[status] ?? 0,
                title: HANDOFF_STATUS_META[status].description,
              })),
            ]}
          />
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon="handoff"
          title={
            resolved.length === 0
              ? "No handoffs in flight"
              : "Nothing in this state"
          }
          description={
            resolved.length === 0
              ? "Nothing has reached the end of its stage yet. Handoffs appear as agents finish work and pass it on."
              : "No handoffs are sitting in this state right now."
          }
        />
      ) : (
        <PanelBody className="space-y-2.5">
          {visible.map((handoff) => (
            <HandoffRow
              key={handoff.id}
              handoff={handoff}
              referenceIso={referenceIso}
              compact={preview}
              onStatusChange={onStatusChange}
            />
          ))}
        </PanelBody>
      )}

      <PanelFooter className="mt-auto">
        <span>
          {counts.blocked ?? 0} blocked · {counts["needs-revision"] ?? 0}{" "}
          returned for revision
        </span>
        {preview && onViewAll ? (
          <Button variant="ghost" onClick={onViewAll}>
            View all handoffs
            <Icon name="arrow-right" className="h-4 w-4" />
          </Button>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>State changes are held in this session only.</span>
            <ListExpander
              expanded={expanded}
              onToggle={() => setExpanded((open) => !open)}
              shown={COLLAPSED_ROWS}
              total={matching.length}
              noun="handoffs"
            />
          </span>
        )}
      </PanelFooter>
    </Panel>
  );
}

function HandoffRow({
  handoff,
  referenceIso,
  compact,
  onStatusChange,
}: {
  handoff: AgentHandoff;
  referenceIso: string;
  compact: boolean;
  onStatusChange: (id: string, status: HandoffStatus) => void;
}) {
  const meta = HANDOFF_STATUS_META[handoff.status];

  return (
    <article
      className={cn(
        "rounded-md border border-l-2 border-border bg-surface-raised px-3.5 py-3",
        handoff.status === "blocked"
          ? "border-l-critical"
          : handoff.status === "needs-revision"
            ? "border-l-warning"
            : handoff.status === "accepted"
              ? "border-l-positive"
              : "border-l-accent",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[12.5px]">
          <AgentChip agent={handoff.from} />
          <Icon
            name="arrow-right"
            className={cn(
              "h-4 w-4 shrink-0",
              handoff.status === "blocked" ? "text-critical" : "text-fg-subtle",
            )}
          />
          <AgentChip agent={handoff.to} />
        </p>

        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
      </div>

      <p className="mt-2.5 text-[12.5px] leading-snug text-fg">
        {handoff.workItem}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-2.5 text-[11.5px] text-fg-subtle">
        <Link
          href={`/projects/${handoff.projectId}`}
          className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
        >
          <Icon name="projects" className="h-3.5 w-3.5" />
          {handoff.projectName}
        </Link>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="clock" className="h-3.5 w-3.5" />
          {formatRelative(handoff.at, referenceIso)}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon name="info" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{handoff.reviewState}</span>
        </span>

        {!compact && (
          <>
            <span className="flex-1" />
            <label className="inline-flex items-center gap-2">
              <span className="sr-only">
                Handoff state for {handoff.workItem}
              </span>
              <span className="block w-40">
                <Select
                  size="sm"
                  value={handoff.status}
                  onChange={(event) =>
                    onStatusChange(
                      handoff.id,
                      event.target.value as HandoffStatus,
                    )
                  }
                  options={HANDOFF_STATUS_ORDER.map((status) => ({
                    value: status,
                    label: HANDOFF_STATUS_META[status].label,
                  }))}
                />
              </span>
            </label>
          </>
        )}
      </div>
    </article>
  );
}

function AgentChip({ agent }: { agent: AgentId }) {
  return (
    <Link
      href={`/agents/${agent}`}
      className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border-strong bg-surface py-0.5 pr-2.5 pl-1 transition-colors hover:border-accent/40"
    >
      <span
        aria-hidden="true"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[9px] font-semibold text-fg-subtle"
      >
        {INITIALS[agent]}
      </span>
      <span className="truncate text-[11.5px] font-medium text-fg-muted">
        {AGENT_NAMES[agent]}
      </span>
    </Link>
  );
}
