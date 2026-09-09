"use client";

import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_LABELS } from "@/lib/mock/dashboard";
import { AGENT_NAMES } from "@/lib/mock/seo";
import type {
  ActivityCategory,
  ActivityEvent,
  ActivityState,
} from "@/types/dashboard";

/**
 * The audit trail: what the platform and its agents have done, newest first.
 *
 * Every event carries a timestamp, a category, and a state, so the feed can be
 * read as a record rather than a stream of notifications.
 */

const CATEGORY_ICON: Record<ActivityCategory, IconName> = {
  agent: "agents",
  technical: "technical",
  content: "content",
  ranking: "trend-up",
  competitor: "competitors",
  authority: "backlinks",
  "ai-visibility": "ai-visibility",
};

const STATE_STYLES: Record<ActivityState, { dot: string; ring: string; label: string }> = {
  success: { dot: "bg-positive", ring: "border-positive/30", label: "Completed" },
  info: { dot: "bg-accent", ring: "border-accent/30", label: "Recorded" },
  warning: { dot: "bg-warning", ring: "border-warning/35", label: "Needs attention" },
  critical: { dot: "bg-critical", ring: "border-critical/35", label: "Failed" },
};

type Filter = ActivityCategory | "all";

export function ActivityFeed({
  events,
  referenceIso,
}: {
  events: readonly ActivityEvent[];
  referenceIso: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: events.length };
    for (const event of events) {
      tally[event.category] = (tally[event.category] ?? 0) + 1;
    }
    return tally;
  }, [events]);

  const visible = filter === "all"
    ? events
    : events.filter((event) => event.category === filter);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Audit trail"
        title="Recent Activity"
        description="Every action the platform and its agents have taken, newest first."
      />

      <div className="border-b border-border px-4 py-3 sm:px-5">
        <Segmented
          label="Filter activity by category"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all" as const, label: "All", count: counts.all },
            ...ACTIVITY_CATEGORIES.filter(
              (category) => (counts[category] ?? 0) > 0,
            ).map((category) => ({
              value: category,
              label: ACTIVITY_CATEGORY_LABELS[category],
              count: counts[category],
            })),
          ]}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="activity"
          title="No activity in this category"
          description="Nothing has been recorded here for this project yet."
        />
      ) : (
        <ol className="divide-y divide-border lg:grid lg:grid-cols-2 lg:divide-y-0">
          {visible.map((event, index) => {
            const state = STATE_STYLES[event.state];

            return (
              <li
                key={event.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface-raised/60 sm:px-5",
                  // On two columns the horizontal rules are drawn per cell so
                  // the two lanes keep their own row separation.
                  "lg:border-b lg:border-border",
                  index % 2 === 0 && "lg:border-r",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-surface-raised text-fg-muted",
                    state.ring,
                  )}
                >
                  <Icon name={CATEGORY_ICON[event.category]} className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h4 className="text-[12.5px] font-medium text-fg">
                      {event.title}
                    </h4>
                    <span
                      aria-hidden="true"
                      className={cn("h-1.5 w-1.5 rounded-full", state.dot)}
                    />
                    <span className="sr-only">{state.label}.</span>
                    <span className="text-[11.5px] text-fg-subtle">
                      {formatRelative(event.at, referenceIso)}
                    </span>
                  </div>

                  <p className="mt-1 text-[12px] leading-relaxed text-fg-subtle">
                    {event.detail}
                  </p>

                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-subtle">
                    <span className="rounded border border-border px-1.5 py-0.5">
                      {ACTIVITY_CATEGORY_LABELS[event.category]}
                    </span>
                    {event.agent && <span>{AGENT_NAMES[event.agent]}</span>}
                    <span aria-hidden="true">·</span>
                    <span>{event.project}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <PanelFooter>
        <span>
          {visible.length} of {events.length} events
        </span>
        <span>Full run history arrives with the AI Agents module.</span>
      </PanelFooter>
    </Panel>
  );
}
