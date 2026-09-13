"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatCompact, formatShortDate } from "@/lib/format";
import {
  CANNIBALIZATION_RISK_META,
  CANNIBALIZATION_RISK_ORDER,
  CANNIBALIZATION_STATE_META,
} from "@/lib/mock/keywords";
import { ListExpander } from "@/components/agents/list-expander";
import {
  IntentBadge,
  KeywordLink,
  OwnerLink,
} from "@/components/keywords/keyword-chrome";
import type {
  CannibalizationRecord,
  CannibalizationRisk,
  CannibalizationState,
} from "@/types/keyword";

/**
 * Keywords two of our own pages are competing for.
 *
 * The traffic split is the argument: each page's share of the clicks is shown
 * against its position, so "these two pages are fighting" is a number rather
 * than an assertion. The lost-traffic figure is what one consolidated page a
 * few places higher would earn instead — an estimate, and labelled as one.
 *
 * The three controls record a decision in this session's state. Nothing here
 * issues a redirect, edits a page, or creates a task; a consolidation is real
 * work on a real site, and this milestone has no way to do it (CLAUDE.md §4).
 */

const PREVIEW = 6;

export function CannibalizationView({
  records,
  states,
  onResolve,
}: {
  records: readonly CannibalizationRecord[];
  states: Record<string, CannibalizationState>;
  onResolve: (id: string, state: CannibalizationState) => void;
}) {
  const [risk, setRisk] = useState<CannibalizationRisk | "all">("all");
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: records.length };
    for (const record of records) {
      tally[record.risk] = (tally[record.risk] ?? 0) + 1;
    }
    return tally;
  }, [records]);

  const visible = useMemo(
    () =>
      risk === "all"
        ? records
        : records.filter((record) => record.risk === risk),
    [records, risk],
  );

  const shown = expanded ? visible : visible.slice(0, PREVIEW);
  const openCount = records.filter(
    (record) => (states[record.id] ?? "open") === "open",
  ).length;
  const lost = records.reduce((carry, record) => carry + record.lostTraffic, 0);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Cannibalisation"
        title="Pages competing with each other"
        description="Keywords where more than one of our own pages ranks, splitting the clicks between them."
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {openCount > 0 && (
              <Badge tone="warning" dot>
                {openCount} unresolved
              </Badge>
            )}
            <Badge tone="neutral">
              ~{formatCompact(lost)} sessions / mo lost to splits
            </Badge>
          </span>
        }
      />

      {records.length === 0 ? (
        <EmptyState
          icon="split"
          title="No cannibalisation detected"
          description="Every keyword in the set has exactly one page of ours ranking for it. Nothing is competing with itself."
        />
      ) : (
        <>
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <Segmented
              label="Filter by cannibalisation risk"
              value={risk}
              onChange={(next) => {
                setRisk(next);
                setExpanded(false);
              }}
              options={[
                { value: "all" as const, label: "All", count: counts.all },
                ...CANNIBALIZATION_RISK_ORDER.filter(
                  (entry) => (counts[entry] ?? 0) > 0,
                ).map((entry) => ({
                  value: entry,
                  label: CANNIBALIZATION_RISK_META[entry].label,
                  count: counts[entry],
                  title: CANNIBALIZATION_RISK_META[entry].description,
                })),
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon="check"
              title="Nothing at this risk level"
              description="No detected split sits in this band."
            />
          ) : (
            <PanelBody className="space-y-3">
              {shown.map((record) => (
                <CannibalizationCard
                  key={record.id}
                  record={record}
                  state={states[record.id] ?? "open"}
                  onResolve={onResolve}
                />
              ))}
            </PanelBody>
          )}
        </>
      )}

      <PanelFooter>
        <ListExpander
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
          shown={PREVIEW}
          total={visible.length}
          noun="splits"
        />
        <span>
          Traffic shares are modelled from each page&apos;s position. Actions
          record a decision in this session only.
        </span>
      </PanelFooter>
    </Panel>
  );
}

function CannibalizationCard({
  record,
  state,
  onResolve,
}: {
  record: CannibalizationRecord;
  state: CannibalizationState;
  onResolve: (id: string, state: CannibalizationState) => void;
}) {
  const meta = CANNIBALIZATION_RISK_META[record.risk];
  const stateMeta = CANNIBALIZATION_STATE_META[state];
  const resolved = state !== "open";

  return (
    <article
      className={cn(
        "rounded-md border bg-surface-raised px-3.5 py-3",
        resolved
          ? "border-positive/30"
          : record.risk === "critical" || record.risk === "high"
            ? "border-critical/30"
            : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Icon name="split" className="h-4 w-4 shrink-0 text-fg-subtle" />
            <KeywordLink
              id={record.keywordId}
              keyword={record.keyword}
              className="text-[13px]"
            />
            <IntentBadge intent={record.intent} />
            <Badge tone={meta.tone} dot>
              {meta.label} risk
            </Badge>
            <Badge tone={stateMeta.tone}>{stateMeta.label}</Badge>
          </div>

          <p className="mt-1 text-[11.5px] text-fg-subtle">
            {record.projectName} · {formatCompact(record.volume)} searches / mo ·
            detected {formatShortDate(record.detectedAt)} · about{" "}
            {formatCompact(record.lostTraffic)} sessions a month lost to the
            split
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {resolved ? (
            <Button variant="ghost" onClick={() => onResolve(record.id, "open")}>
              Undo
            </Button>
          ) : (
            <>
              <Button
                icon="target"
                onClick={() => onResolve(record.id, "primary-assigned")}
              >
                Assign primary URL
              </Button>
              <Button
                icon="workflow"
                onClick={() => onResolve(record.id, "task-created")}
              >
                Create consolidation task
              </Button>
              <Button
                icon="check"
                onClick={() => onResolve(record.id, "reviewed")}
              >
                Mark resolved
              </Button>
            </>
          )}
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {record.urls.map((entry) => (
          <li
            key={entry.url}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded border border-border bg-surface px-3 py-2"
          >
            <span className="flex min-w-0 grow basis-48 items-center gap-2">
              <Badge tone={entry.role === "primary" ? "accent" : "neutral"}>
                {entry.role === "primary" ? "Primary" : "Competing"}
              </Badge>
              <span
                className="truncate font-mono text-[11.5px] text-fg-muted"
                title={entry.url}
              >
                {entry.url}
              </span>
              <span className="shrink-0 text-[11px] text-fg-subtle">
                {entry.pageType}
              </span>
            </span>

            <span className="flex shrink-0 items-center gap-3">
              <span className="tabular text-[11.5px] text-fg-subtle">
                position{" "}
                <span className="font-medium text-fg">{entry.position}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="w-16">
                  <Meter
                    size="sm"
                    value={entry.trafficShare}
                    tone={entry.role === "primary" ? "accent" : "warning"}
                    label={`${entry.url} takes ${entry.trafficShare}% of the clicks`}
                  />
                </span>
                <span className="tabular w-10 text-right text-[11.5px] text-fg-muted">
                  {entry.trafficShare}%
                </span>
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2.5 flex items-start gap-2 border-t border-border pt-2.5 text-[11.5px] leading-relaxed text-fg-muted">
        <Icon name="info" className="mt-px h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1">{record.resolution}</span>
        <OwnerLink agent={record.owner} className="shrink-0" />
      </p>
    </article>
  );
}
