"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatCompact, formatShortDate } from "@/lib/format";
import { FORMAT_META, STAGE_META } from "@/lib/mock/content";
import { BriefDocument } from "@/components/content/brief-document";
import {
  IntentBadge,
  OwnerLink,
  StageBadge,
} from "@/components/content/content-chrome";
import type { ContentBrief, ContentStage } from "@/types/content";

/**
 * The briefs an editor is working from.
 *
 * A list beside the open document rather than a grid of cards: a brief is
 * something you read, and reading one while keeping the queue in view is how
 * the work actually goes. The first brief opens by default so the panel is
 * never an empty frame waiting to be clicked.
 *
 * Only live work appears here. Every published piece has a brief behind it,
 * but a brief for a page that shipped two years ago is a historical document,
 * not a queue item — the detail workspace is where those are read.
 */

type BriefFilter = "all" | ContentStage;

export function BriefsView({
  briefs,
  onOpenGaps,
}: {
  briefs: readonly ContentBrief[];
  /** Sends the reader to the gaps queue when there is nothing briefed. */
  onOpenGaps: () => void;
}) {
  const [stage, setStage] = useState<BriefFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: briefs.length };
    for (const brief of briefs) {
      tally[brief.stage] = (tally[brief.stage] ?? 0) + 1;
    }
    return tally;
  }, [briefs]);

  const visible = useMemo(
    () =>
      [
        ...(stage === "all"
          ? briefs
          : briefs.filter((brief) => brief.stage === stage)),
      ].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)),
    [briefs, stage],
  );

  const open =
    visible.find((brief) => brief.id === selectedId) ?? visible[0] ?? null;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <SectionHeader
            eyebrow="Briefs"
            title="What the writers are working from"
            description="One brief per piece in flight, assembled from the keywords it has to carry and the pages it has to beat."
            actions={
              <Segmented
                label="Filter briefs by stage"
                value={stage}
                onChange={setStage}
                options={[
                  { value: "all" as const, label: "All", count: counts.all },
                  ...(Object.keys(STAGE_META) as ContentStage[])
                    .filter((entry) => (counts[entry] ?? 0) > 0)
                    .map((entry) => ({
                      value: entry,
                      label: STAGE_META[entry].label,
                      count: counts[entry],
                      title: STAGE_META[entry].description,
                    })),
                ]}
              />
            }
          />
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon="brief"
            title={
              briefs.length === 0
                ? "No briefs in this selection"
                : "No briefs at this stage"
            }
            description={
              briefs.length === 0
                ? "Nothing in the current filters has work in flight against it. The content gaps are where the next briefs come from."
                : "Every brief in this selection sits at a different stage."
            }
            action={
              briefs.length === 0 ? (
                <Button icon="target" onClick={onOpenGaps}>
                  Open the content gaps
                </Button>
              ) : (
                <Button icon="close" onClick={() => setStage("all")}>
                  Show every stage
                </Button>
              )
            }
          />
        ) : (
          <PanelBody>
            <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
              <ul
                className="max-h-[560px] space-y-1.5 overflow-y-auto pr-1"
                aria-label="Briefs in this selection"
              >
                {visible.map((brief) => {
                  const active = open?.id === brief.id;

                  return (
                    <li key={brief.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(brief.id)}
                        aria-pressed={active}
                        className={cn(
                          "w-full rounded-md border px-3 py-2.5 text-left transition-colors",
                          active
                            ? "border-accent/40 bg-accent-soft"
                            : "border-border bg-surface-raised hover:border-border-strong",
                        )}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0 text-[12.5px] leading-snug font-medium text-fg">
                            {brief.title}
                          </span>
                          <StageBadge stage={brief.stage} short />
                        </span>

                        <span className="mt-1 block truncate text-[11px] text-fg-subtle">
                          {FORMAT_META[brief.format].label} ·{" "}
                          {brief.wordTarget.toLocaleString("en-US")} words ·{" "}
                          {brief.outline.length} sections
                        </span>

                        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <IntentBadge intent={brief.intent} short />
                          <span className="tabular inline-flex items-center gap-1 text-[11px] text-fg-subtle">
                            <Icon name="calendar" className="h-3 w-3" />
                            {formatShortDate(brief.dueAt)}
                          </span>
                          {brief.secondaryKeywords.length > 0 && (
                            <span className="tabular text-[11px] text-fg-subtle">
                              +{brief.secondaryKeywords.length} keywords
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="min-w-0">
                {open ? (
                  <BriefDocument brief={open} eyebrow="Open brief" />
                ) : (
                  <EmptyState
                    icon="brief"
                    size="sm"
                    title="Select a brief"
                    description="Choose one from the list to read it."
                  />
                )}
              </div>
            </div>
          </PanelBody>
        )}

        <PanelFooter>
          <span>
            {visible.length} of {briefs.length} briefs. Every one is generated
            from the canonical keyword set and is read-only.
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="info" className="h-3.5 w-3.5" />
            Briefs for pages that shipped long ago live on the piece itself.
          </span>
        </PanelFooter>
      </Panel>
    </div>
  );
}

/** One brief summarised in a row, for the overview panel. */
export function BriefRow({ brief }: { brief: ContentBrief }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium text-fg">
          {brief.title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-fg-subtle">
          {FORMAT_META[brief.format].label} · {brief.primaryKeyword}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Badge tone="neutral">
          {formatCompact(brief.wordTarget)} words
        </Badge>
        <StageBadge stage={brief.stage} short />
        <OwnerLink agent={brief.writer} className="text-[11px]" />
      </span>
    </div>
  );
}
