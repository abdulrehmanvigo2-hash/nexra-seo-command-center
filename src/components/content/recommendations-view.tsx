"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import {
  CHECK_META,
  CHECK_ORDER,
  RECOMMENDATION_STATE_META,
  SEVERITY_ORDER,
} from "@/lib/mock/content";
import { ListExpander } from "@/components/agents/list-expander";
import { ContentLink, OwnerLink } from "@/components/content/content-chrome";
import type {
  OnPageCheckId,
  OnPageRecommendation,
  Priority,
  RecommendationState,
} from "@/types/content";

/**
 * On-page findings across the inventory.
 *
 * Grouped by what is wrong rather than by which page it is wrong on, because
 * that is how the work is actually batched: an afternoon spent adding answer
 * blocks is one job, and the same afternoon spread across twelve unrelated
 * fixes is three. The check filter is the primary control for that reason.
 *
 * Every finding carries the points it would return to the page's content
 * score, so the queue can be worked in the order that pays rather than the
 * order it was generated in.
 *
 * The controls record a decision in this session and say so. Nothing edits a
 * page — there is no CMS behind this (CLAUDE.md §4).
 */

const PREVIEW = 12;

export function RecommendationsView({
  recommendations,
  states,
  onAct,
}: {
  recommendations: readonly OnPageRecommendation[];
  /** Decisions recorded in this session, by recommendation id. */
  states: Record<string, RecommendationState>;
  onAct: (id: string, state: RecommendationState) => void;
}) {
  const [severity, setSeverity] = useState<Priority | "all">("all");
  const [check, setCheck] = useState<OnPageCheckId | "all">("all");
  const [hideHandled, setHideHandled] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const severityCounts = useMemo(() => {
    const tally: Record<string, number> = { all: recommendations.length };
    for (const entry of recommendations) {
      tally[entry.severity] = (tally[entry.severity] ?? 0) + 1;
    }
    return tally;
  }, [recommendations]);

  const checkCounts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const entry of recommendations) {
      tally[entry.check] = (tally[entry.check] ?? 0) + 1;
    }
    return tally;
  }, [recommendations]);

  const visible = useMemo(
    () =>
      recommendations.filter((entry) => {
        if (severity !== "all" && entry.severity !== severity) return false;
        if (check !== "all" && entry.check !== check) return false;
        if (hideHandled) {
          const state = states[entry.id] ?? "open";
          if (state !== "open") return false;
        }
        return true;
      }),
    [recommendations, severity, check, hideHandled, states],
  );

  const shown = expanded ? visible : visible.slice(0, PREVIEW);

  const recoverable = visible.reduce(
    (carry, entry) => carry + entry.scoreImpact,
    0,
  );
  const handled = recommendations.filter(
    (entry) => (states[entry.id] ?? "open") !== "open",
  ).length;

  return (
    <Panel>
      <div className="border-b border-border px-4 py-3.5 sm:px-5">
        <SectionHeader
          eyebrow="On-page"
          title="What is wrong, and what fixes it"
          description="Every finding across the selection, with the points it would return to the page it is on."
          actions={
            <span className="text-[11.5px] text-fg-subtle">
              {visible.length} findings · {recoverable} points recoverable
            </span>
          }
        />
      </div>

      <Toolbar label="Filter on-page findings" className="gap-x-3">
        <Segmented
          label="Filter findings by severity"
          value={severity}
          onChange={(next) => {
            setSeverity(next);
            setExpanded(false);
          }}
          options={[
            { value: "all" as const, label: "All", count: severityCounts.all },
            ...SEVERITY_ORDER.filter(
              (entry) => (severityCounts[entry] ?? 0) > 0,
            ).map((entry) => ({
              value: entry,
              label: entry.charAt(0).toUpperCase() + entry.slice(1),
              count: severityCounts[entry],
            })),
          ]}
        />

        <ToolbarSpacer />

        <ToolbarGroup>
          <label className="flex items-center gap-2 text-[11.5px] text-fg-subtle">
            Check
            <span className="block w-52">
              <Select
                size="sm"
                value={check}
                onChange={(event) => {
                  setCheck(event.target.value as OnPageCheckId | "all");
                  setExpanded(false);
                }}
                options={[
                  { value: "all", label: "Every check" },
                  ...CHECK_ORDER.filter(
                    (entry) => (checkCounts[entry] ?? 0) > 0,
                  ).map((entry) => ({
                    value: entry,
                    label: `${CHECK_META[entry].label} (${checkCounts[entry]})`,
                  })),
                ]}
              />
            </span>
          </label>

          <button
            type="button"
            aria-pressed={hideHandled}
            onClick={() => setHideHandled((value) => !value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors",
              hideHandled
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-border-strong bg-surface-raised text-fg-muted hover:bg-surface-hover",
            )}
          >
            <Icon name="filter" className="h-3.5 w-3.5" />
            Hide handled
            {handled > 0 && <span className="tabular">({handled})</span>}
          </button>
        </ToolbarGroup>
      </Toolbar>

      {shown.length === 0 ? (
        <EmptyState
          icon="check"
          title={
            recommendations.length === 0
              ? "Nothing to fix in this selection"
              : "No findings match these filters"
          }
          description={
            recommendations.length === 0
              ? "Every page in the current selection passes the on-page checks."
              : hideHandled
                ? "Every remaining finding here has already been acted on in this session."
                : "No finding in the current selection is of this kind."
          }
          action={
            recommendations.length > 0 ? (
              <Button
                icon="close"
                onClick={() => {
                  setSeverity("all");
                  setCheck("all");
                  setHideHandled(false);
                }}
              >
                Clear these filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <PanelBody>
          <ul className="space-y-2">
            {shown.map((entry) => {
              const state = states[entry.id] ?? "open";
              const meta = CHECK_META[entry.check];

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
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-fg">
                          <Icon
                            name={meta.icon}
                            className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                          />
                          {meta.label}
                        </span>
                        <PriorityBadge priority={entry.severity} />
                        <Badge tone="accent" title="Points returned to the content score">
                          +{entry.scoreImpact}
                        </Badge>
                        {state !== "open" && (
                          <Badge tone={RECOMMENDATION_STATE_META[state].tone}>
                            {RECOMMENDATION_STATE_META[state].label}
                          </Badge>
                        )}
                      </p>

                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-muted">
                        {entry.finding}
                      </p>
                      <p className="mt-1 text-[12px] leading-relaxed text-fg-subtle">
                        <span className="font-medium text-fg-muted">Fix: </span>
                        {entry.action}
                      </p>

                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-subtle">
                        <ContentLink
                          id={entry.contentId}
                          title={entry.contentTitle}
                          className="text-[11.5px]"
                        />
                        <OwnerLink agent={entry.owner} className="text-[11.5px]" />
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {state === "open" ? (
                        <>
                          <Button
                            icon="plus"
                            onClick={() => onAct(entry.id, "accepted")}
                          >
                            Add to plan
                          </Button>
                          <Button
                            icon="check"
                            onClick={() => onAct(entry.id, "done")}
                          >
                            Mark fixed
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
          noun="findings"
        />
        <span className="inline-flex items-center gap-1.5">
          <Icon name="info" className="h-3.5 w-3.5" />
          Decisions are recorded for this session only — no page is edited.
        </span>
      </PanelFooter>
    </Panel>
  );
}
