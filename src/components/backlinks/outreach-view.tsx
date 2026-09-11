"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import {
  OUTREACH_KIND_META,
  OUTREACH_KIND_ORDER,
  OUTREACH_STAGE_CYCLE,
  OUTREACH_STAGE_META,
} from "@/lib/mock/backlinks";
import {
  AuthorityValue,
  DomainText,
  EffortBadge,
  OutreachKindBadge,
  ProvenanceTag,
  ScoreValue,
  SeverityBadge,
  StageBadge,
} from "@/components/backlinks/link-chrome";
import type {
  LinkSeverity,
  OutreachKind,
  OutreachOpportunity,
  OutreachStage,
} from "@/types/backlinks";

/**
 * The authority work queue.
 *
 * Every job is derived from something already in the graph — a gap, a lost
 * link, a lapsed relationship, a flagged link, a page hoarding authority. None
 * of them is a prospect somebody typed in.
 *
 * Ranking is value divided by effort, computed in the scoring layer, the same
 * method the Technical SEO and AI Visibility queues use.
 *
 * Moving a job through its stages is session state and nothing else. No email
 * is sent, no site is contacted, no disavow file is submitted (CLAUDE.md §4).
 */

const BORDER: Record<LinkSeverity, string> = {
  critical: "border-l-critical",
  high: "border-l-critical/70",
  medium: "border-l-warning",
  low: "border-l-border-strong",
};

export function OutreachView({
  opportunities,
  kind,
  onKindChange,
  stages,
  onStageChange,
}: {
  opportunities: readonly OutreachOpportunity[];
  kind: OutreachKind | "all";
  onKindChange: (value: OutreachKind | "all") => void;
  stages: Readonly<Record<string, OutreachStage>>;
  onStageChange: (id: string, stage: OutreachStage) => void;
}) {
  const counts: Record<string, number> = {};
  for (const entry of opportunities) {
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  }

  const visible =
    kind === "all"
      ? opportunities
      : opportunities.filter((entry) => entry.kind === kind);

  const won = opportunities.filter(
    (entry) => (stages[entry.id] ?? entry.stage) === "won",
  ).length;

  return (
    <div className="space-y-4">
      <Panel>
        <Toolbar label="Filter the queue by job kind" className="gap-x-3">
          <Segmented
            label="Filter the queue by job kind"
            value={kind}
            onChange={onKindChange}
            options={[
              {
                value: "all" as const,
                label: "All",
                count: opportunities.length,
              },
              ...OUTREACH_KIND_ORDER.filter(
                (entry) => (counts[entry] ?? 0) > 0,
              ).map((entry) => ({
                value: entry,
                label: OUTREACH_KIND_META[entry].label,
                count: counts[entry],
                title: OUTREACH_KIND_META[entry].description,
              })),
            ]}
          />
          <ToolbarSpacer />
          <p
            aria-live="polite"
            className="text-[11.5px] whitespace-nowrap text-fg-subtle"
          >
            {visible.length} {visible.length === 1 ? "job" : "jobs"} · {won}{" "}
            marked won this session
          </p>
        </Toolbar>
      </Panel>

      {visible.length === 0 ? (
        <Panel>
          <EmptyState
            icon="check"
            title="Nothing queued for this selection"
            description="Either there is no outstanding authority work here, or the filters have narrowed past the last job. Clear a filter to widen the set."
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {visible.map((entry) => {
            const stage = stages[entry.id] ?? entry.stage;
            const nextStage =
              OUTREACH_STAGE_CYCLE[
                (OUTREACH_STAGE_CYCLE.indexOf(stage) + 1) %
                  OUTREACH_STAGE_CYCLE.length
              ];

            return (
              <Panel
                key={entry.id}
                className={cn(
                  "border-l-2",
                  BORDER[entry.severity],
                  stage === "declined" ? "opacity-60" : undefined,
                )}
              >
                <PanelHeader
                  eyebrow={`${entry.projectName} · ${OUTREACH_KIND_META[entry.kind].label}`}
                  title={entry.title}
                  description={entry.explanation}
                  actions={
                    <>
                      <SeverityBadge severity={entry.severity} />
                      <EffortBadge effort={entry.effort} />
                      <Button
                        variant="ghost"
                        onClick={() => onStageChange(entry.id, nextStage)}
                        title={`Currently ${OUTREACH_STAGE_META[stage].label.toLowerCase()}. Move to ${OUTREACH_STAGE_META[nextStage].label.toLowerCase()} for this session.`}
                      >
                        {OUTREACH_STAGE_META[stage].label}
                        <Icon name="chevron-right" className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  }
                />

                <PanelBody className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <OutreachKindBadge kind={entry.kind} />
                    <StageBadge stage={stage} />
                    {entry.domain !== null && (
                      <DomainText domain={entry.domain} />
                    )}
                    {entry.authority > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-fg-subtle">
                        DA <AuthorityValue authority={entry.authority} />
                      </span>
                    )}
                    <span className="text-[11.5px] text-fg-subtle">
                      Owner {AGENT_NAMES[entry.owner]}
                    </span>
                    <ProvenanceTag provenance={entry.provenance} />
                    <span className="ml-auto flex items-center gap-3">
                      {entry.estimatedTraffic > 0 && (
                        <span className="tabular text-[11.5px] text-fg-subtle">
                          ~{formatCompact(entry.estimatedTraffic)} sessions / mo
                        </span>
                      )}
                      <ScoreValue score={entry.priority} label="Priority" />
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
                      <p className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                        Why it is worth doing
                      </p>
                      <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
                        {entry.impact}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
                      <p className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                        Recommended action
                      </p>
                      <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
                        {entry.action}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {entry.contentId !== null && entry.targetTitle !== null && (
                      <Link
                        href={`/content/${entry.contentId}`}
                        className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-border bg-surface px-2 py-1 text-[11.5px] text-fg-muted transition-colors hover:border-accent/40 hover:text-accent"
                        title={entry.targetTitle}
                      >
                        <Icon name="content" className="h-3.5 w-3.5 shrink-0" />
                        {entry.targetTitle}
                      </Link>
                    )}
                    {entry.affectedLinks > 0 && (
                      <span className="text-[11.5px] text-fg-subtle">
                        {entry.affectedLinks}{" "}
                        {entry.affectedLinks === 1 ? "link" : "links"} behind
                        this job
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-fg-subtle">
                      Stage is recorded for this session only — nothing is sent.
                    </span>
                  </div>
                </PanelBody>
              </Panel>
            );
          })}

          <p className="flex items-start gap-1.5 px-1 text-[11.5px] text-fg-subtle">
            <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Priority is what winning the link is worth divided by how much work
            it is, so a reclaim can outrank a bigger but harder placement.
          </p>
        </div>
      )}
    </div>
  );
}
