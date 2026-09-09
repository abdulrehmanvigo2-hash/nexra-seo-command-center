"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { getNavItem } from "@/config/navigation";
import type { AlertSeverity, DashboardAlert } from "@/types/dashboard";

/**
 * Risks that need a decision: traffic drops, ranking losses, indexing faults,
 * crawl spikes, lost links, decaying content, competitor surges.
 *
 * Severity is carried by a badge and a left border rather than by filling the
 * whole card, so a page with several critical alerts still reads as a control
 * centre rather than an incident wall.
 */

type Filter = AlertSeverity | "all";

const SEVERITY_BORDER: Record<AlertSeverity, string> = {
  critical: "border-l-critical",
  high: "border-l-warning",
  medium: "border-l-accent",
  low: "border-l-border-strong",
};

export function AlertsPanel({
  alerts,
  referenceIso,
}: {
  alerts: readonly DashboardAlert[];
  referenceIso: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [dismissed, setDismissed] = useState<readonly string[]>([]);

  const live = useMemo(
    () => alerts.filter((alert) => !dismissed.includes(alert.id)),
    [alerts, dismissed],
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: live.length };
    for (const alert of live) {
      tally[alert.severity] = (tally[alert.severity] ?? 0) + 1;
    }
    return tally;
  }, [live]);

  const visible = filter === "all"
    ? live
    : live.filter((alert) => alert.severity === filter);

  const critical = counts.critical ?? 0;

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Monitoring"
        title="Alerts & Risks"
        description="Detected automatically and ranked by how much is at stake."
        actions={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium",
              critical > 0
                ? "border-critical/35 bg-critical/10 text-critical"
                : "border-border-strong bg-surface-raised text-fg-muted",
            )}
          >
            <Icon name="alert" className="h-3.5 w-3.5" />
            {critical} critical
          </span>
        }
      />

      <div className="border-b border-border px-4 py-3 sm:px-5">
        <Segmented
          label="Filter alerts by severity"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all" as const, label: "All", count: counts.all },
            { value: "critical" as const, label: "Critical", count: counts.critical ?? 0 },
            { value: "high" as const, label: "High", count: counts.high ?? 0 },
            { value: "medium" as const, label: "Medium", count: counts.medium ?? 0 },
            { value: "low" as const, label: "Low", count: counts.low ?? 0 },
          ]}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="shield"
          title={live.length === 0 ? "No open alerts" : "Nothing at this severity"}
          description={
            live.length === 0
              ? "Monitoring is running across every tracked property. New risks will appear here as they are detected."
              : "No live alert carries this severity. Clear the filter to see the rest."
          }
          action={
            dismissed.length > 0 ? (
              <Button icon="refresh" onClick={() => setDismissed([])}>
                Restore {dismissed.length} dismissed
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex-1 divide-y divide-border">
          {visible.map((alert) => (
            <li
              key={alert.id}
              className={cn(
                "border-l-2 px-4 py-3.5 transition-colors hover:bg-surface-raised/60 sm:px-5",
                SEVERITY_BORDER[alert.severity],
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityBadge priority={alert.severity} />
                  <span className="text-[11.5px] text-fg-subtle">
                    {formatRelative(alert.detectedAt, referenceIso)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDismissed((current) => [...current, alert.id])
                  }
                  aria-label={`Dismiss alert: ${alert.title}`}
                  className="shrink-0 rounded p-1 text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  <Icon name="close" className="h-3.5 w-3.5" />
                </button>
              </div>

              <h4 className="mt-2 text-[13px] leading-snug font-medium text-fg">
                {alert.title}
              </h4>
              <p className="mt-1.5 text-[12px] leading-relaxed text-fg-subtle">
                {alert.detail}
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-[11.5px] text-fg-subtle">
                  {alert.metric}
                </span>
                <TrendIndicator value={alert.change.value} />
                <Link
                  href={alert.module}
                  className="inline-flex items-center gap-1 text-[11.5px] text-accent transition-colors hover:text-accent-hover"
                >
                  {getNavItem(alert.module).label}
                  <Icon name="chevron-right" className="h-3.5 w-3.5" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PanelFooter>
        <span>
          {live.length} live
          {dismissed.length > 0 && ` · ${dismissed.length} dismissed`}
        </span>
        {dismissed.length > 0 && (
          <button
            type="button"
            onClick={() => setDismissed([])}
            className="text-fg-muted transition-colors hover:text-fg"
          >
            Restore dismissed
          </button>
        )}
      </PanelFooter>
    </Panel>
  );
}
