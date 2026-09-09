"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { ACTION_AREA_META } from "@/lib/mock/dashboard";
import { AGENT_NAMES } from "@/lib/mock/seo";
import { getNavItem } from "@/config/navigation";
import type { ActionState, PriorityAction, Priority } from "@/types/dashboard";

/**
 * What to do next, in the order the SEO Director would present it.
 *
 * Each row expands to show the reasoning and the destination module, and can
 * be moved to "In review" — frontend state over the fixture, which is as far
 * as this milestone goes. The row links to the module that owns the follow-up;
 * those routes exist, so nothing here is a dead link.
 */

type Filter = Priority | "all";

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export function PriorityActions({
  actions,
}: {
  actions: readonly PriorityAction[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, ActionState>>({});

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: actions.length };
    for (const action of actions) {
      tally[action.priority] = (tally[action.priority] ?? 0) + 1;
    }
    return tally;
  }, [actions]);

  const visible = filter === "all"
    ? actions
    : actions.filter((action) => action.priority === filter);

  const reviewing = Object.values(states).filter(
    (state) => state === "in-review",
  ).length;

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="SEO Director"
        title="Priority Actions"
        description="Ranked by expected impact against the effort each one takes."
      />

      <div className="border-b border-border px-4 py-3 sm:px-5">
        <Segmented
          label="Filter actions by priority"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((entry) => ({
            ...entry,
            count: counts[entry.value] ?? 0,
          }))}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="check"
          title="Nothing at this priority"
          description="No action in the queue carries this priority right now."
        />
      ) : (
        <ul className="flex-1 divide-y divide-border">
          {visible.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              state={states[action.id] ?? action.state}
              expanded={expanded === action.id}
              onToggle={() =>
                setExpanded((current) =>
                  current === action.id ? null : action.id,
                )
              }
              onReview={() =>
                setStates((current) => ({
                  ...current,
                  [action.id]:
                    (current[action.id] ?? action.state) === "in-review"
                      ? "open"
                      : "in-review",
                }))
              }
            />
          ))}
        </ul>
      )}

      <PanelFooter>
        <span>
          {visible.length} of {actions.length} shown
          {reviewing > 0 && ` · ${reviewing} moved to review`}
        </span>
        <Link
          href="/agents"
          className="inline-flex items-center gap-1 text-fg-muted transition-colors hover:text-fg"
        >
          Agent workload
          <Icon name="arrow-right" className="h-3.5 w-3.5" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}

function ActionRow({
  action,
  state,
  expanded,
  onToggle,
  onReview,
}: {
  action: PriorityAction;
  state: ActionState;
  expanded: boolean;
  onToggle: () => void;
  onReview: () => void;
}) {
  const area = ACTION_AREA_META[action.area];
  const destination = getNavItem(action.module);

  return (
    <li className={cn("transition-colors", expanded && "bg-surface-raised/60")}>
      <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-raised text-fg-subtle"
        >
          <Icon name={area.icon} className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={action.priority} />
            <span className="text-[11.5px] text-fg-subtle">{area.label}</span>
            {state === "in-review" && (
              <Badge tone="accent" dot>
                In review
              </Badge>
            )}
          </div>

          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="mt-1.5 block text-left"
          >
            <span className="text-[13px] leading-snug font-medium text-fg">
              {action.title}
            </span>
          </button>

          <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-fg-subtle">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Affected</dt>
              <Icon name="pages" className="h-3.5 w-3.5" />
              <dd>{action.affected}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Expected impact</dt>
              <Icon name="trend-up" className="h-3.5 w-3.5" />
              <dd className="text-positive">{action.impact}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Owner</dt>
              <Icon name="agents" className="h-3.5 w-3.5" />
              <dd>{AGENT_NAMES[action.owner]}</dd>
            </div>
          </dl>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant={action.priority === "critical" ? "primary" : "secondary"}
            onClick={onToggle}
            aria-expanded={expanded}
          >
            {action.cta}
          </Button>
          <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? "Hide details" : "Show details"}
            aria-expanded={expanded}
            className="rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Icon
              name="chevron-down"
              className={cn(
                "h-4 w-4 transition-transform",
                expanded && "rotate-180",
              )}
            />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border bg-surface px-4 py-3.5 sm:px-5">
          <p className="text-[12.5px] leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">Recommended action. </span>
            {action.recommendation}
          </p>

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[11.5px]">
            <div>
              <dt className="text-fg-subtle">Impact</dt>
              <dd className="mt-0.5 text-fg-muted capitalize">
                {action.impactLevel}
              </dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Effort</dt>
              <dd className="mt-0.5 text-fg-muted capitalize">{action.effort}</dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Owner</dt>
              <dd className="mt-0.5 text-fg-muted">
                {AGENT_NAMES[action.owner]}
              </dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Module</dt>
              <dd className="mt-0.5 text-fg-muted">{destination.label}</dd>
            </div>
          </dl>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Link href={action.module} className={buttonClasses("secondary", "sm")}>
              <Icon name="external" className="h-4 w-4" />
              Open {destination.label}
            </Link>
            <Button variant="ghost" onClick={onReview}>
              {state === "in-review" ? "Move back to open" : "Mark as in review"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
