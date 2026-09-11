"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { AGENT_NAMES } from "@/lib/mock/seo";
import { GAP_META } from "@/lib/mock/ai-visibility";
import {
  GapKindBadge,
  ProvenanceTag,
  ScoreValue,
  SeverityBadge,
} from "@/components/ai-visibility/ai-chrome";
import type { AiGapRecord, AiSeverity } from "@/types/ai-visibility";

/**
 * AI-specific findings.
 *
 * Where a gap defers to a canonical Technical SEO finding, the card says so
 * and links through to it rather than restating the defect — so a reader never
 * sees the same problem counted twice across two modules.
 */

const BORDER: Record<AiSeverity, string> = {
  critical: "border-l-critical",
  high: "border-l-critical/70",
  medium: "border-l-warning",
  low: "border-l-border-strong",
};

export function GapsView({
  gaps,
  onFilterKind,
}: {
  gaps: readonly AiGapRecord[];
  onFilterKind: (kind: AiGapRecord["kind"]) => void;
}) {
  if (gaps.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="check"
          title="No AI gaps for this selection"
          description="Either nothing here would trip up an answer engine, or the filters have narrowed past the last finding. Clear a filter to widen the set."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      {gaps.map((gap) => (
        <Panel key={gap.id} className={cn("border-l-2", BORDER[gap.severity])}>
          <PanelHeader
            eyebrow={`${gap.projectName}${gap.topicName ? ` · ${gap.topicName}` : ""}`}
            title={GAP_META[gap.kind].label}
            description={gap.reason}
            actions={
              <>
                <SeverityBadge severity={gap.severity} />
                <ScoreValue
                  score={gap.opportunityValue}
                  label="Opportunity value"
                />
              </>
            }
          />

          <PanelBody className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onFilterKind(gap.kind)}
                title={`Narrow the workspace to ${GAP_META[gap.kind].label.toLowerCase()} findings`}
                className="rounded-md transition-opacity hover:opacity-80"
              >
                <GapKindBadge kind={gap.kind} />
              </button>
              <span className="text-[11.5px] text-fg-subtle">
                Owner {AGENT_NAMES[gap.owner]}
              </span>
              <ProvenanceTag provenance={gap.provenance} />
            </div>

            <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
              <p className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                Suggested action
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
                {gap.action}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {gap.pageId !== null && gap.pageTitle !== null && (
                <Link
                  href={`/content/${gap.pageId.replace(/^ai-/, "")}?tab=ai`}
                  className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-border bg-surface px-2 py-1 text-[11.5px] text-fg-muted transition-colors hover:border-accent/40 hover:text-accent"
                  title={gap.pageTitle}
                >
                  <Icon name="content" className="h-3.5 w-3.5 shrink-0" />
                  {gap.pageTitle}
                </Link>
              )}

              {gap.entityName !== null && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11.5px] text-fg-muted">
                  <Icon name="layers" className="h-3.5 w-3.5 shrink-0" />
                  {gap.entityName}
                </span>
              )}

              {gap.sourceIssueId !== null && (
                <Link
                  href="/technical?tab=issues"
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent-soft px-2 py-1 text-[11.5px] text-accent transition-opacity hover:opacity-80"
                  title="This finding defers to a Technical SEO issue rather than restating it."
                >
                  <Icon name="technical" className="h-3.5 w-3.5 shrink-0" />
                  Owned by Technical SEO
                </Link>
              )}
            </div>
          </PanelBody>
        </Panel>
      ))}
    </div>
  );
}

/** The queue of AI jobs, session-only. */
export function OpportunitiesFooter({
  accepted,
  total,
  onClear,
}: {
  accepted: number;
  total: number;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-[11.5px] text-fg-subtle">
        {accepted} of {total} accepted this session. Nothing is dispatched,
        crawled, or written anywhere.
      </p>
      {accepted > 0 && (
        <Button variant="ghost" icon="refresh" onClick={onClear}>
          Reset decisions
        </Button>
      )}
    </div>
  );
}
