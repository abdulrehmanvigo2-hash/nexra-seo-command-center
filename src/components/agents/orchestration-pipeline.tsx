"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { WORKFLOW_STATE_META } from "@/lib/mock/agents";
import type { AgentWorkflow, WorkflowStage } from "@/types/agent";

/**
 * How work moves through the twelve-stage loop.
 *
 * Not a diagram with states painted on it: each stage shows the real state of
 * the agent holding it on the selected project, so a blocked hand-off here is
 * the same blocked hand-off the agent's own workspace reports.
 *
 * The loop closes — Analytics & Learning hands back to the SEO Director — so
 * the last stage is drawn joining the first rather than trailing off the end.
 */
export function OrchestrationPipeline({
  workflows,
  referenceIso,
}: {
  workflows: readonly AgentWorkflow[];
  referenceIso: string;
}) {
  const [selectedId, setSelectedId] = useState(workflows[0]?.id ?? "");

  const workflow =
    workflows.find((entry) => entry.id === selectedId) ?? workflows[0];

  if (!workflow) return null;

  const blocked = workflow.stages.filter(
    (stage) => stage.state === "blocked",
  ).length;
  const review = workflow.stages.filter(
    (stage) => stage.state === "review",
  ).length;

  /** The furthest stage the work has got to, as a 1-based position. */
  const reached = Math.round(
    (workflow.progress / 100) * workflow.stages.length,
  );

  return (
    <Panel>
      <PanelHeader
        eyebrow="Orchestration"
        title="SEO Workflow Pipeline"
        description="One cycle through the twelve agents, from strategy to measurement and back to the Director."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {blocked > 0 && (
              <Badge tone="critical" dot>
                {blocked} blocked hand-off{blocked === 1 ? "" : "s"}
              </Badge>
            )}
            {review > 0 && (
              <Badge tone="warning" dot>
                {review} awaiting review
              </Badge>
            )}
            <label className="inline-flex items-center gap-2">
              <span className="sr-only">Show the pipeline for</span>
              <span className="block w-48">
                <Select
                  size="sm"
                  value={workflow.id}
                  onChange={(event) => setSelectedId(event.target.value)}
                  options={workflows.map((entry) => ({
                    value: entry.id,
                    label: entry.projectName,
                  }))}
                />
              </span>
            </label>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-fg">
            {workflow.objective}
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-fg-subtle">
            {workflow.client} · last movement{" "}
            {formatRelative(workflow.updatedAt, referenceIso)}
          </p>
        </div>

        {/*
          The bar says how far round the loop this cycle has *reached*, which
          is not the same as how many stages have finished — several stages run
          at once. Both numbers are on screen, so the wording has to say which
          is which rather than leaving a full bar to be read as "done".
        */}
        <div className="min-w-[200px] flex-1 sm:max-w-xs">
          <div className="flex items-baseline justify-between gap-3 text-[11.5px] text-fg-subtle">
            <span>
              {reached > 0
                ? `Reached stage ${reached} of ${workflow.stages.length}`
                : "Not started"}
            </span>
            <span className="tabular">{workflow.progress}%</span>
          </div>
          <Meter
            className="mt-1.5"
            value={workflow.progress}
            tone={blocked > 0 ? "warning" : "accent"}
            label={`${workflow.projectName}: cycle has reached stage ${reached} of ${workflow.stages.length}`}
          />
        </div>
      </div>

      <PanelBody>
        <ol className="space-y-1.5">
          {workflow.stages.map((stage, index) => (
            <StageRow
              key={stage.agent}
              stage={stage}
              referenceIso={referenceIso}
              isCurrent={index === workflow.activeIndex}
              isLast={index === workflow.stages.length - 1}
            />
          ))}
        </ol>

        <p className="mt-3 flex items-start gap-2 rounded-md border border-border bg-surface-raised px-3 py-2.5 text-[11.5px] leading-relaxed text-fg-subtle">
          <Icon name="refresh" className="mt-px h-3.5 w-3.5 shrink-0" />
          The loop closes: what Analytics &amp; Learning finds is handed back to
          the SEO Director, which re-prioritises the next cycle.
        </p>
      </PanelBody>

      <PanelFooter>
        <span>
          {workflow.completedStages} of {workflow.stages.length} stages have
          finished and handed on; the rest are running, waiting, or not yet
          started.
        </span>
        <Link
          href={workflow.href}
          className={buttonClasses("secondary", "sm")}
        >
          Open {workflow.projectName}
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}

function StageRow({
  stage,
  referenceIso,
  isCurrent,
  isLast,
}: {
  stage: WorkflowStage;
  referenceIso: string;
  isCurrent: boolean;
  isLast: boolean;
}) {
  const meta = WORKFLOW_STATE_META[stage.state];

  return (
    <li
      className={cn(
        "relative flex gap-3 rounded-md border px-3 py-2.5 transition-colors",
        isCurrent
          ? "border-accent/40 bg-accent-soft/40"
          : stage.state === "blocked"
            ? "border-critical/35 bg-surface-raised"
            : "border-border bg-surface-raised",
        !stage.staffed && "opacity-60",
      )}
    >
      {/* The connector between stages, drawn behind the marker. */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute top-[42px] left-[26px] h-[calc(100%-24px)] w-px bg-border"
        />
      )}

      <span
        aria-hidden="true"
        className={cn(
          "relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-surface text-[10.5px] font-semibold",
          meta.ring,
          stage.state === "pending" ? "text-fg-subtle" : "text-fg-muted",
        )}
      >
        {stage.state === "complete" ? (
          <Icon name="check" className="h-3.5 w-3.5 text-positive" />
        ) : (
          stage.stage
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="flex min-w-0 items-center gap-2 text-[12.5px] font-medium text-fg">
            <span className="truncate">{stage.name}</span>
            {isCurrent && (
              <span className="shrink-0 text-[10.5px] font-medium text-accent">
                Current stage
              </span>
            )}
          </p>

          <span className="flex shrink-0 items-center gap-2">
            {stage.handoffBlocked && (
              <span
                className="inline-flex items-center gap-1 text-[10.5px] whitespace-nowrap text-warning"
                title="Work is not reaching the next agent"
              >
                <Icon name="handoff" className="h-3.5 w-3.5" />
                Hand-off held
              </span>
            )}
            <Badge tone={meta.tone} dot={stage.state !== "pending"}>
              {meta.label}
            </Badge>
          </span>
        </div>

        <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
          {stage.note}
        </p>

        {stage.staffed && stage.state !== "pending" && (
          <div className="mt-2 flex items-center gap-2.5">
            <Meter
              className="max-w-[200px] flex-1"
              size="sm"
              value={stage.progress}
              tone={
                stage.state === "blocked"
                  ? "critical"
                  : stage.state === "review"
                    ? "warning"
                    : stage.state === "complete"
                      ? "positive"
                      : "accent"
              }
              label={`${stage.name} stage progress`}
            />
            <span className="tabular shrink-0 text-[10.5px] text-fg-subtle">
              {stage.progress}%
            </span>
            <span className="shrink-0 text-[10.5px] whitespace-nowrap text-fg-subtle">
              {formatRelative(stage.at, referenceIso)}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}
