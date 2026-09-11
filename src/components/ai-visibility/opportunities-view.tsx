"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import { AGENT_NAMES } from "@/lib/mock/seo";
import {
  OPPORTUNITY_KIND_META,
  OPPORTUNITY_KIND_ORDER,
} from "@/lib/mock/ai-visibility";
import {
  ConfidenceTag,
  EffortBadge,
  OpportunityKindBadge,
  ProvenanceTag,
  ScoreValue,
  SeverityBadge,
} from "@/components/ai-visibility/ai-chrome";
import type {
  AiOpportunity,
  AiOpportunityKind,
  AiOpportunityState,
  AiPageRecord,
  AiSeverity,
} from "@/types/ai-visibility";

/**
 * The AI visibility work queue.
 *
 * Every entry reads gaps from the registry — same severity, same owner, same
 * pages. What it adds is effort, and therefore ranking: value divided by
 * effort, computed in the scoring layer, the same method the Technical SEO
 * queue uses so the two read consistently side by side.
 *
 * Accepting a job records it for this session and nothing else: no agent is
 * dispatched, no crawl is queued, nothing is written (CLAUDE.md §4).
 */

const BORDER: Record<AiSeverity, string> = {
  critical: "border-l-critical",
  high: "border-l-critical/70",
  medium: "border-l-warning",
  low: "border-l-border-strong",
};

export function OpportunitiesView({
  opportunities,
  pagesById,
  kind,
  onKindChange,
  states,
  onStateChange,
}: {
  opportunities: readonly AiOpportunity[];
  pagesById: ReadonlyMap<string, AiPageRecord>;
  kind: AiOpportunityKind | "all";
  onKindChange: (value: AiOpportunityKind | "all") => void;
  states: Readonly<Record<string, AiOpportunityState>>;
  onStateChange: (id: string, state: AiOpportunityState) => void;
}) {
  const counts: Record<string, number> = {};
  for (const entry of opportunities) {
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  }

  const visible =
    kind === "all"
      ? opportunities
      : opportunities.filter((entry) => entry.kind === kind);

  const accepted = opportunities.filter(
    (entry) => states[entry.id] === "accepted",
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
              ...OPPORTUNITY_KIND_ORDER.filter(
                (entry) => (counts[entry] ?? 0) > 0,
              ).map((entry) => ({
                value: entry,
                label: OPPORTUNITY_KIND_META[entry].label,
                count: counts[entry],
                title: OPPORTUNITY_KIND_META[entry].description,
              })),
            ]}
          />
          <ToolbarSpacer />
          <p
            aria-live="polite"
            className="text-[11.5px] whitespace-nowrap text-fg-subtle"
          >
            {visible.length} {visible.length === 1 ? "job" : "jobs"} ·{" "}
            {accepted} accepted this session
          </p>
        </Toolbar>
      </Panel>

      {visible.length === 0 ? (
        <Panel>
          <EmptyState
            icon="check"
            title="Nothing queued for this selection"
            description="Either there is no outstanding AI-visibility work here, or the filters have narrowed past the last job. Clear a filter to widen the set."
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {visible.map((entry) => {
            const state = states[entry.id] ?? "open";
            const samples = entry.pageIds
              .slice(0, 4)
              .map((id) => pagesById.get(id))
              .filter((page): page is AiPageRecord => page !== undefined);

            return (
              <Panel
                key={entry.id}
                className={cn(
                  "border-l-2",
                  BORDER[entry.severity],
                  state === "dismissed" ? "opacity-60" : undefined,
                )}
              >
                <PanelHeader
                  eyebrow={`${entry.projectName} · ${OPPORTUNITY_KIND_META[entry.kind].label}`}
                  title={entry.title}
                  description={entry.explanation}
                  actions={
                    <>
                      <SeverityBadge severity={entry.severity} />
                      <EffortBadge effort={entry.effort} />
                    </>
                  }
                />

                <PanelBody className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <OpportunityKindBadge kind={entry.kind} />
                    <span className="text-[11.5px] text-fg-subtle">
                      {entry.affectedPages > 0
                        ? `${entry.affectedPages} ${entry.affectedPages === 1 ? "page" : "pages"} · `
                        : ""}
                      Owner {AGENT_NAMES[entry.owner]}
                    </span>
                    <ProvenanceTag provenance={entry.provenance} />
                    <ConfidenceTag confidence={entry.confidence} />
                    <span className="ml-auto flex items-center gap-3">
                      <span className="tabular text-[11.5px] text-fg-subtle">
                        Impact {entry.impactScore}
                      </span>
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

                  {samples.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                        Pages this would touch
                      </p>
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {samples.map((page) => (
                          <li key={page.id} className="min-w-0 max-w-full">
                            <Link
                              href={`/content/${page.contentId}?tab=ai`}
                              title={`${page.title} — ${page.path}`}
                              className="inline-block max-w-full truncate rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px] text-fg-subtle transition-colors hover:border-accent/40 hover:text-accent"
                            >
                              {page.path}
                            </Link>
                          </li>
                        ))}
                        {entry.affectedPages > samples.length && (
                          <li className="self-center text-[11px] text-fg-subtle">
                            +{entry.affectedPages - samples.length} more
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant={state === "accepted" ? "primary" : "secondary"}
                      icon="check"
                      onClick={() =>
                        onStateChange(
                          entry.id,
                          state === "accepted" ? "open" : "accepted",
                        )
                      }
                    >
                      {state === "accepted" ? "Accepted" : "Accept"}
                    </Button>
                    <Button
                      variant="ghost"
                      icon="close"
                      onClick={() =>
                        onStateChange(
                          entry.id,
                          state === "dismissed" ? "open" : "dismissed",
                        )
                      }
                    >
                      {state === "dismissed" ? "Dismissed" : "Dismiss"}
                    </Button>
                    <span className="text-[11px] text-fg-subtle">
                      Recorded for this session only — nothing is dispatched.
                    </span>
                  </div>
                </PanelBody>
              </Panel>
            );
          })}

          <p className="flex items-start gap-1.5 px-1 text-[11.5px] text-fg-subtle">
            <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Priority is what the fix is worth divided by how much work it is, so
            a cheap job can outrank a more valuable expensive one. Confidence
            says how much the underlying reading can be trusted.
          </p>
        </div>
      )}
    </div>
  );
}
