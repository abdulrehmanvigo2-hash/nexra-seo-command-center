"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import {
  OPPORTUNITY_CATEGORY_META,
  OPPORTUNITY_CATEGORY_ORDER,
  OPPORTUNITY_STATE_META,
} from "@/lib/mock/keywords";
import {
  DifficultyValue,
  IntentBadge,
  KeywordLink,
  OpportunityValue,
  OwnerLink,
  PositionValue,
  TargetUrl,
  VolumeValue,
} from "@/components/keywords/keyword-chrome";
import { ListExpander } from "@/components/agents/list-expander";
import type {
  KeywordOpportunity,
  Level,
  OpportunityCategory,
  OpportunityState,
  StrikingDistanceRow,
} from "@/types/keyword";

/**
 * What to do next, in the order it is worth doing.
 *
 * Nine categories, each a plain rule over the keyword set rather than an
 * authored list, so an opportunity always carries the reason it qualified and
 * the number it is expected to move. A keyword can appear under more than one
 * heading — a term can genuinely be both a quick win and a competitor gap.
 *
 * The controls record a decision in this session's state and say so. Nothing
 * here writes a brief, creates a task, or schedules work (CLAUDE.md §4).
 */

const PREVIEW = 8;

const LEVEL_TONE: Record<Level, "positive" | "accent" | "neutral"> = {
  high: "positive",
  medium: "accent",
  low: "neutral",
};

export function OpportunitiesView({
  opportunities,
  striking,
  states,
  onAct,
}: {
  opportunities: readonly KeywordOpportunity[];
  striking: readonly StrikingDistanceRow[];
  /** Opportunities acted on in this session. */
  states: Record<string, OpportunityState>;
  onAct: (id: string, state: OpportunityState) => void;
}) {
  const [category, setCategory] = useState<OpportunityCategory | "all">(
    "quick-win",
  );
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: opportunities.length };
    for (const entry of opportunities) {
      tally[entry.category] = (tally[entry.category] ?? 0) + 1;
    }
    return tally;
  }, [opportunities]);

  const visible = useMemo(
    () =>
      category === "all"
        ? opportunities
        : opportunities.filter((entry) => entry.category === category),
    [opportunities, category],
  );

  const shown = expanded ? visible : visible.slice(0, PREVIEW);
  const meta =
    category === "all" ? null : OPPORTUNITY_CATEGORY_META[category];

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Opportunities"
          title="Keyword opportunities"
          description={
            meta?.description ??
            "Every opening across the keyword set, strongest opportunity score first."
          }
          actions={
            <span className="text-[11.5px] text-fg-subtle">
              {opportunities.length} findings across nine categories
            </span>
          }
        />

        <div className="border-b border-border px-4 py-3 sm:px-5">
          <Segmented
            label="Filter opportunities by category"
            value={category}
            onChange={(next) => {
              setCategory(next);
              setExpanded(false);
            }}
            options={[
              { value: "all" as const, label: "All", count: counts.all },
              ...OPPORTUNITY_CATEGORY_ORDER.filter(
                (entry) => (counts[entry] ?? 0) > 0,
              ).map((entry) => ({
                value: entry,
                label: OPPORTUNITY_CATEGORY_META[entry].label,
                count: counts[entry],
                title: OPPORTUNITY_CATEGORY_META[entry].description,
              })),
            ]}
          />
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon="check"
            title="Nothing open in this category"
            description="No keyword in the current set qualifies. That is a good result — the rule that fills this list found nothing to report."
          />
        ) : (
          <PanelBody className="space-y-2.5">
            {shown.map((entry) => (
              <OpportunityRow
                key={entry.id}
                opportunity={entry}
                state={states[entry.id] ?? "open"}
                onAct={onAct}
              />
            ))}
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
            Acting on an opportunity records a decision in this session only.
          </span>
        </PanelFooter>
      </Panel>

      <StrikingDistancePanel rows={striking} />
    </div>
  );
}

function OpportunityRow({
  opportunity,
  state,
  onAct,
}: {
  opportunity: KeywordOpportunity;
  state: OpportunityState;
  onAct: (id: string, state: OpportunityState) => void;
}) {
  const meta = OPPORTUNITY_CATEGORY_META[opportunity.category];
  const acted = state !== "open";

  const nextState: OpportunityState =
    opportunity.cta === "Create brief"
      ? "briefed"
      : opportunity.cta === "Add to plan"
        ? "planned"
        : "reviewed";

  return (
    <article
      className={cn(
        "rounded-md border bg-surface-raised px-3.5 py-3 transition-colors",
        acted ? "border-positive/30" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={meta.tone}>
              <Icon name={meta.icon} className="h-3 w-3" />
              {meta.label}
            </Badge>
            <KeywordLink
              id={opportunity.keywordId}
              keyword={opportunity.keyword}
              className="text-[13px]"
            />
            <IntentBadge intent={opportunity.intent} />
            <PriorityBadge priority={opportunity.urgency} />
          </div>

          <p className="mt-1.5 text-[12px] leading-relaxed text-fg-muted">
            {opportunity.reason}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-fg-subtle">
            <span className="text-positive">{opportunity.expectedImpact}</span>
            <span>
              Impact{" "}
              <Badge tone={LEVEL_TONE[opportunity.impact]}>
                {opportunity.impact}
              </Badge>
            </span>
            <span>
              Effort{" "}
              <Badge tone={LEVEL_TONE[opportunity.effort]}>
                {opportunity.effort}
              </Badge>
            </span>
            <span className="tabular">
              {formatCompact(opportunity.volume)} / mo
            </span>
            <span className="truncate">{opportunity.projectName}</span>
            <OwnerLink agent={opportunity.owner} />
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <OpportunityValue score={opportunity.score} showMeter={false} />
          {acted ? (
            <span className="flex items-center gap-2">
              <Badge tone={OPPORTUNITY_STATE_META[state].tone} dot>
                {OPPORTUNITY_STATE_META[state].label}
              </Badge>
              <Button
                variant="ghost"
                onClick={() => onAct(opportunity.id, "open")}
              >
                Undo
              </Button>
            </span>
          ) : (
            <Button
              variant="secondary"
              onClick={() => onAct(opportunity.id, nextState)}
            >
              {opportunity.cta}
              <Icon name="arrow-right" className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {opportunity.targetUrl !== null && (
        <p className="mt-2 border-t border-border pt-2">
          <TargetUrl url={opportunity.targetUrl} />
        </p>
      )}
    </article>
  );
}

/**
 * Keywords ranking between four and twenty.
 *
 * The most actionable list in the module, so it is a table rather than cards:
 * the decision is made by comparing rows, and the click-through columns say
 * exactly where the extra traffic comes from.
 */
function StrikingDistancePanel({
  rows,
}: {
  rows: readonly StrikingDistanceRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, 10);

  const totalUpside = rows.reduce((carry, row) => carry + row.ctrUpside, 0);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Striking distance"
        title="Positions 4 to 20"
        description="Close enough that a few places change the traffic. The upside is the difference between the click-through rate now and at the target position."
        actions={
          <Badge tone="accent">
            +{formatCompact(totalUpside)} sessions / mo available
          </Badge>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="target"
          title="Nothing in striking distance"
          description="No keyword in the current set ranks between positions 4 and 20."
        />
      ) : (
        <Table caption="Keywords ranking between positions 4 and 20, with their click-through upside">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Keyword</TableHeaderCell>
              <TableHeaderCell>Intent</TableHeaderCell>
              <TableHeaderCell align="right">Now</TableHeaderCell>
              <TableHeaderCell align="right">Target</TableHeaderCell>
              <TableHeaderCell align="right">Volume</TableHeaderCell>
              <TableHeaderCell align="right">Diff.</TableHeaderCell>
              <TableHeaderCell align="right">CTR now</TableHeaderCell>
              <TableHeaderCell align="right">CTR target</TableHeaderCell>
              <TableHeaderCell align="right">Upside</TableHeaderCell>
              <TableHeaderCell>Target page</TableHeaderCell>
              <TableHeaderCell>Recommended optimisation</TableHeaderCell>
              <TableHeaderCell align="right">Score</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.keywordId}>
                <TableCell header className="max-w-[240px] min-w-[180px]">
                  <KeywordLink
                    id={row.keywordId}
                    keyword={row.keyword}
                    className="block truncate"
                  />
                  <span className="mt-0.5 block truncate text-[11px] font-normal text-fg-subtle">
                    {row.projectName}
                  </span>
                </TableCell>
                <TableCell>
                  <IntentBadge intent={row.intent} short />
                </TableCell>
                <TableCell numeric>
                  <PositionValue position={row.position} />
                </TableCell>
                <TableCell numeric className="text-accent">
                  {row.targetPosition}
                </TableCell>
                <TableCell numeric>
                  <VolumeValue volume={row.volume} />
                </TableCell>
                <TableCell numeric>
                  <DifficultyValue difficulty={row.difficulty} showMeter={false} />
                </TableCell>
                <TableCell numeric>{row.currentCtr}%</TableCell>
                <TableCell numeric className="text-positive">
                  {row.targetCtr}%
                </TableCell>
                <TableCell numeric className="font-medium text-positive">
                  +{formatCompact(row.ctrUpside)}
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <TargetUrl url={row.targetUrl} />
                </TableCell>
                <TableCell className="max-w-[280px] min-w-[220px]">
                  <span className="block leading-snug">{row.recommendation}</span>
                  <span className="mt-1 block">
                    <OwnerLink agent={row.owner} className="text-[11px]" />
                  </span>
                </TableCell>
                <TableCell numeric>
                  <OpportunityValue score={row.score} showMeter={false} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <PanelFooter>
        <ListExpander
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
          shown={10}
          total={rows.length}
          noun="keywords"
        />
        <span>
          Click-through rates come from a modelled curve, not a measurement.
        </span>
      </PanelFooter>
    </Panel>
  );
}
