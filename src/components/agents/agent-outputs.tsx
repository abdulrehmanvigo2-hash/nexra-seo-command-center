"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { getNavItem } from "@/config/navigation";
import { cn } from "@/lib/cn";
import { formatCompact, formatRelative } from "@/lib/format";
import { HEALTH_DOT, healthOf } from "@/lib/health";
import { OUTPUT_STATUS_META } from "@/lib/mock/agents";
import { ListExpander } from "@/components/agents/list-expander";
import type { AgentOutput } from "@/types/agent";

/**
 * The deliverables an agent has filed.
 *
 * A record of work produced, not a document store: the artifacts themselves
 * live in the modules that own them, so "View" points at the real module
 * rather than opening a file that does not exist yet.
 */

type Filter = string;

const COLLAPSED_ROWS = 6;

export function AgentOutputs({
  outputs,
  referenceIso,
  /** The window total, which is larger than the sample listed here. */
  totalVolume,
  outputLabel,
}: {
  outputs: readonly AgentOutput[];
  referenceIso: string;
  totalVolume: number;
  outputLabel: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);

  const types = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const output of outputs) {
      tally[output.type] = (tally[output.type] ?? 0) + 1;
    }
    return tally;
  }, [outputs]);

  const matching =
    filter === "all"
      ? outputs
      : outputs.filter((output) => output.type === filter);

  const visible = matching.slice(
    0,
    expanded ? matching.length : COLLAPSED_ROWS,
  );

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Deliverables"
        title="Recent Outputs"
        description="Named artifacts this agent has filed, newest first."
        actions={
          <Badge tone="neutral">
            {formatCompact(totalVolume)} {outputLabel} this window
          </Badge>
        }
      />

      {outputs.length > 0 && (
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <Segmented
            label="Filter outputs by kind"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: outputs.length },
              ...Object.entries(types).map(([type, count]) => ({
                value: type,
                label: type,
                count,
              })),
            ]}
          />
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon="brief"
          title={
            outputs.length === 0 ? "No outputs filed yet" : "Nothing of this kind"
          }
          description={
            outputs.length === 0
              ? "This agent has not filed a named deliverable on any of its projects in this window."
              : "No deliverables of this kind have been filed in this window."
          }
        />
      ) : (
        <PanelBody className="space-y-2.5">
          {visible.map((output) => (
            <OutputRow
              key={output.id}
              output={output}
              referenceIso={referenceIso}
            />
          ))}
        </PanelBody>
      )}

      <PanelFooter className="mt-auto">
        <span>
          Showing {visible.length} of {matching.length} named deliverables.
        </span>
        <ListExpander
          expanded={expanded}
          onToggle={() => setExpanded((open) => !open)}
          shown={COLLAPSED_ROWS}
          total={matching.length}
          noun="outputs"
        />
      </PanelFooter>
    </Panel>
  );
}

function OutputRow({
  output,
  referenceIso,
}: {
  output: AgentOutput;
  referenceIso: string;
}) {
  const meta = OUTPUT_STATUS_META[output.status];
  const destination = getNavItem(output.module);
  const health = healthOf(output.quality);

  return (
    <article className="rounded-md border border-border bg-surface-raised px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">
              <Icon name="brief" className="h-3 w-3" />
              {output.type}
            </Badge>
            <StatusBadge status={meta.status} label={meta.label} />
          </div>

          <h4 className="mt-2 text-[12.5px] leading-snug font-medium text-fg">
            {output.title}
          </h4>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
            Quality
          </p>
          <p className="tabular mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg">
            <span
              aria-hidden="true"
              className={cn("h-1.5 w-1.5 rounded-full", HEALTH_DOT[health])}
            />
            {output.quality}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-2.5 text-[11.5px] text-fg-subtle">
        <Link
          href={`/projects/${output.projectId}`}
          className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
        >
          <Icon name="projects" className="h-3.5 w-3.5" />
          {output.projectName}
        </Link>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="clock" className="h-3.5 w-3.5" />
          {formatRelative(output.createdAt, referenceIso)}
        </span>

        <span className="flex-1" />

        <Button
          variant="ghost"
          // The artifact itself belongs to the module that produces it, and
          // those modules arrive in their own phases. Pointing at the module is
          // honest; opening a document that does not exist would not be.
          disabled
          title={`Opening the artifact arrives with ${destination.label}`}
        >
          View
          <Icon name="external" className="h-4 w-4" />
        </Button>
      </div>
    </article>
  );
}
