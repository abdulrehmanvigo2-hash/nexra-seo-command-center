"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { AGENT_IDS, AGENT_NAMES } from "@/lib/mock/agents";
import { PIPELINE_STAGES, STAGE_META } from "@/lib/mock/content";
import type { AgentId, ContentStage } from "@/types/content";

/**
 * What can be done to several pieces at once.
 *
 * Appears only when something is selected, and every action here changes this
 * session's state and nothing else: a stage is recorded against the selection,
 * an owner is reassigned, a refresh is queued, a piece is marked reviewed.
 * Nothing is written anywhere, nothing is published, and nothing is deleted —
 * there is deliberately no destructive action in this bar, because a delete
 * with nothing behind it would be a lie about what the product can do
 * (CLAUDE.md §4).
 *
 * Each action reports what it did rather than closing silently, so a bulk
 * change is never something the user has to go and verify.
 */
export function ContentBulkActions({
  count,
  onClear,
  onMoveStage,
  onAssignAgent,
  onQueueRefresh,
  onMarkReviewed,
  onExport,
  notice,
}: {
  count: number;
  onClear: () => void;
  onMoveStage: (stage: ContentStage) => void;
  onAssignAgent: (agent: AgentId) => void;
  onQueueRefresh: () => void;
  onMarkReviewed: () => void;
  onExport: () => void;
  /** Confirmation of the last action, cleared by the workspace. */
  notice: string | null;
}) {
  const [stage, setStage] = useState<ContentStage>("brief");
  const [agent, setAgent] = useState<AgentId>("content-strategist");

  const stageSelectId = useId();
  const agentSelectId = useId();

  if (count === 0) return null;

  return (
    <div className="border-b border-accent/25 bg-accent-soft/40 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-fg">
          <Icon name="check" className="h-4 w-4 text-accent" />
          {count} {count === 1 ? "piece" : "pieces"} selected
        </span>

        <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />

        <span className="flex items-center gap-1.5">
          <label htmlFor={stageSelectId} className="sr-only">
            Stage to move the selection to
          </label>
          <span className="block w-40">
            <Select
              id={stageSelectId}
              size="sm"
              value={stage}
              onChange={(event) =>
                setStage(event.target.value as ContentStage)
              }
              options={PIPELINE_STAGES.map((entry) => ({
                value: entry,
                label: STAGE_META[entry].label,
              }))}
            />
          </span>
          <Button icon="workflow" onClick={() => onMoveStage(stage)}>
            Move stage
          </Button>
        </span>

        <span className="flex items-center gap-1.5">
          <label htmlFor={agentSelectId} className="sr-only">
            Agent to assign the selection to
          </label>
          <span className="block w-44">
            <Select
              id={agentSelectId}
              size="sm"
              value={agent}
              onChange={(event) => setAgent(event.target.value as AgentId)}
              options={AGENT_IDS.map((id) => ({
                value: id,
                label: AGENT_NAMES[id],
              }))}
            />
          </span>
          <Button icon="agents" onClick={() => onAssignAgent(agent)}>
            Assign
          </Button>
        </span>

        <Button icon="refresh" onClick={onQueueRefresh}>
          Queue refresh
        </Button>

        <Button icon="check" onClick={onMarkReviewed}>
          Mark reviewed
        </Button>

        <Button icon="upload" onClick={onExport}>
          Prepare export
        </Button>

        <span aria-hidden="true" className="flex-1" />

        <Button variant="ghost" icon="close" onClick={onClear}>
          Clear selection
        </Button>
      </div>

      <p aria-live="polite" className="mt-2 text-[11.5px] text-fg-subtle">
        {notice ??
          "Bulk actions change this session only — nothing is saved, published, or deleted."}
      </p>
    </div>
  );
}
