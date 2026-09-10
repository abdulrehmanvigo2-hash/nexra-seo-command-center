"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import { LINK_KIND_META, LINK_KIND_ORDER } from "@/lib/mock/content";
import { ListExpander } from "@/components/agents/list-expander";
import {
  ContentLink,
  OwnerLink,
  PageUrl,
} from "@/components/content/content-chrome";
import type {
  ContentRecord,
  InternalLinkKind,
  InternalLinkOpportunity,
  LinkState,
} from "@/types/content";

/**
 * Links that should exist and do not.
 *
 * Each row is a single decision: this page should link to that one, with this
 * anchor, for this reason. The anchor is the target page's own primary keyword
 * rather than something invented, because an anchor that does not match what
 * the target is trying to rank for is not a useful suggestion.
 *
 * Orphans get their own panel. A page nothing points at is a different problem
 * from a missing link between two healthy pages: it earns no internal
 * authority at all, and it is easy to miss in a list sorted by anything else.
 *
 * The controls record a decision in this session. Nothing edits a page.
 */

const PREVIEW = 12;

export function LinksView({
  opportunities,
  orphans,
  states,
  onAct,
  onOpenOrphans,
}: {
  opportunities: readonly InternalLinkOpportunity[];
  orphans: readonly ContentRecord[];
  /** Decisions recorded in this session, by opportunity id. */
  states: Record<string, LinkState>;
  onAct: (id: string, state: LinkState) => void;
  /** Applies the orphan flag on the inventory. */
  onOpenOrphans: () => void;
}) {
  const [kind, setKind] = useState<InternalLinkKind | "all">("all");
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: opportunities.length };
    for (const entry of opportunities) {
      tally[entry.kind] = (tally[entry.kind] ?? 0) + 1;
    }
    return tally;
  }, [opportunities]);

  const visible = useMemo(
    () =>
      kind === "all"
        ? opportunities
        : opportunities.filter((entry) => entry.kind === kind),
    [opportunities, kind],
  );

  const shown = expanded ? visible : visible.slice(0, PREVIEW);
  const planned = opportunities.filter(
    (entry) => (states[entry.id] ?? "open") === "planned",
  ).length;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <SectionHeader
            eyebrow="Internal links"
            title="Links worth adding"
            description="Where the site does not point at itself: missing pillar links, stranded pages, and authority sitting where it is not needed."
            actions={
              <Segmented
                label="Filter link opportunities by kind"
                value={kind}
                onChange={(next) => {
                  setKind(next);
                  setExpanded(false);
                }}
                options={[
                  { value: "all" as const, label: "All", count: counts.all },
                  ...LINK_KIND_ORDER.filter(
                    (entry) => (counts[entry] ?? 0) > 0,
                  ).map((entry) => ({
                    value: entry,
                    label: LINK_KIND_META[entry].label,
                    count: counts[entry],
                    title: LINK_KIND_META[entry].description,
                  })),
                ]}
              />
            }
          />
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon="handoff"
            title={
              opportunities.length === 0
                ? "No link opportunities in this selection"
                : "None of this kind"
            }
            description={
              opportunities.length === 0
                ? "Every page in the current selection already links where it should."
                : "No opportunity in the current selection is of this kind."
            }
            action={
              kind !== "all" ? (
                <Button icon="close" onClick={() => setKind("all")}>
                  Show every kind
                </Button>
              ) : undefined
            }
          />
        ) : (
          <PanelBody>
            <ul className="space-y-2">
              {shown.map((entry) => {
                const state = states[entry.id] ?? "open";
                const meta = LINK_KIND_META[entry.kind];

                return (
                  <li
                    key={entry.id}
                    className={cn(
                      "rounded-md border px-3.5 py-3 transition-colors",
                      state === "open"
                        ? "border-border bg-surface-raised"
                        : "border-border/70 bg-surface-raised/50",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <Badge tone={meta.tone} title={meta.description}>
                            <Icon name={meta.icon} className="h-3 w-3" />
                            {meta.label}
                          </Badge>
                          {state === "planned" && (
                            <Badge tone="accent">Added to plan</Badge>
                          )}
                          {state === "dismissed" && (
                            <Badge tone="neutral">Dismissed</Badge>
                          )}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                          <span className="min-w-0">
                            <ContentLink
                              id={entry.fromId}
                              title={entry.fromTitle}
                            />
                          </span>
                          <Icon
                            name="arrow-right"
                            className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                          />
                          <span className="min-w-0">
                            <ContentLink id={entry.toId} title={entry.toTitle} />
                          </span>
                        </div>

                        <p className="mt-1 text-[11.5px] text-fg-subtle">
                          Anchor:{" "}
                          <span className="font-mono text-fg-muted">
                            &ldquo;{entry.anchor}&rdquo;
                          </span>
                        </p>

                        <p className="mt-1.5 text-[12px] leading-relaxed text-fg-subtle">
                          {entry.reason}
                        </p>

                        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
                          <span>{entry.projectName}</span>
                          <OwnerLink agent={entry.owner} className="text-[11px]" />
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <div className="w-24">
                          <p className="text-right text-[10.5px] text-fg-subtle">
                            Impact {entry.strength}
                          </p>
                          <Meter
                            className="mt-1"
                            size="sm"
                            value={entry.strength}
                            tone={
                              entry.strength >= 80
                                ? "critical"
                                : entry.strength >= 60
                                  ? "warning"
                                  : "accent"
                            }
                            label={`Impact ${entry.strength} of 100`}
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {state === "open" ? (
                            <>
                              <Button
                                icon="plus"
                                onClick={() => onAct(entry.id, "planned")}
                              >
                                Add to plan
                              </Button>
                              <Button
                                variant="ghost"
                                icon="close"
                                onClick={() => onAct(entry.id, "dismissed")}
                              >
                                Dismiss
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              icon="refresh"
                              onClick={() => onAct(entry.id, "open")}
                            >
                              Undo
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </PanelBody>
        )}

        <PanelFooter>
          <ListExpander
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            shown={PREVIEW}
            total={visible.length}
            noun="opportunities"
          />
          <span>
            {planned} added to the plan in this session. Nothing is written to a
            page.
          </span>
        </PanelFooter>
      </Panel>

      <Panel>
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <SectionHeader
            eyebrow="Orphans"
            title="Pages nothing links to"
            description="Live pages with no inbound internal link. Nothing passes into them, whatever they are worth."
            actions={
              orphans.length > 0 ? (
                <Button icon="filter" onClick={onOpenOrphans}>
                  Show in the inventory
                </Button>
              ) : undefined
            }
          />
        </div>

        {orphans.length === 0 ? (
          <EmptyState
            icon="check"
            size="sm"
            title="No orphaned pages"
            description="Every live page in the current selection has at least one internal link pointing at it."
          />
        ) : (
          <PanelBody>
            <ul className="grid gap-2 md:grid-cols-2">
              {orphans.map((record) => (
                <li
                  key={record.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-raised px-3 py-2.5"
                >
                  <span className="min-w-0">
                    <ContentLink
                      id={record.id}
                      title={record.title}
                      className="block truncate text-[12.5px]"
                    />
                    <PageUrl url={record.url} className="mt-0.5" />
                  </span>
                  <span className="tabular shrink-0 text-[11px] text-fg-subtle">
                    {formatCompact(record.totalVolume)} / mo
                  </span>
                </li>
              ))}
            </ul>
          </PanelBody>
        )}

        <PanelFooter>
          <span>
            {orphans.length} orphaned {orphans.length === 1 ? "page" : "pages"}{" "}
            in this selection.
          </span>
          <span>Inbound links carry 10% of the content score.</span>
        </PanelFooter>
      </Panel>
    </div>
  );
}
