"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { formatCompact, formatSigned } from "@/lib/format";
import { DATE_RANGES } from "@/lib/mock/dashboard";
import { MOVEMENT_KIND_META, MOVEMENT_KIND_ORDER } from "@/lib/mock/keywords";
import { ListExpander } from "@/components/agents/list-expander";
import {
  ChangeValue,
  IntentBadge,
  KeywordLink,
  PositionValue,
  TargetUrl,
  VolumeValue,
} from "@/components/keywords/keyword-chrome";
import type { MetricTileData } from "@/components/ui/metric-tile";
import type { RangeId } from "@/types/dashboard";
import type {
  KeywordMovementRow,
  KeywordMovementSummary,
  MovementKind,
} from "@/types/keyword";

/**
 * What moved, and whether it mattered.
 *
 * The window is a real control, not a label: selecting 12M asks a different
 * question of the ranking history and gets a different answer. A movement is
 * only listed once it is worth listing, and each row carries the traffic the
 * move was worth — a keyword falling twenty places on a term nobody searches
 * is not the same event as one falling three on a term that pays.
 */

const PREVIEW = 10;

export function MovementView({
  rows,
  summary,
  range,
  onRangeChange,
}: {
  rows: readonly KeywordMovementRow[];
  summary: KeywordMovementSummary;
  range: RangeId;
  onRangeChange: (range: RangeId) => void;
}) {
  const [kind, setKind] = useState<MovementKind>("winner");
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const row of rows) tally[row.kind] = (tally[row.kind] ?? 0) + 1;
    return tally;
  }, [rows]);

  const visible = useMemo(
    () => rows.filter((row) => row.kind === kind),
    [rows, kind],
  );

  const shown = expanded ? visible : visible.slice(0, PREVIEW);
  const caption =
    DATE_RANGES.find((entry) => entry.id === range)?.caption ?? "";

  const metrics: readonly MetricTileData[] = [
    {
      id: "winners",
      label: "Winners",
      value: String(summary.winners),
      detail: "Keywords that gained three places or more",
      icon: "trend-up",
      health: "positive",
    },
    {
      id: "losers",
      label: "Losers",
      value: String(summary.losers),
      detail: "Keywords that lost three places or more",
      icon: "trend-down",
      health: summary.losers > summary.winners ? "negative" : "warning",
    },
    {
      id: "new",
      label: "New rankings",
      value: String(summary.newRankings),
      detail: "Entered the top 100 in this window",
      icon: "plus",
      health: "positive",
    },
    {
      id: "lost",
      label: "Lost rankings",
      value: String(summary.lostRankings),
      detail: "Dropped out of the top 100",
      icon: "link-off",
      health: summary.lostRankings > 0 ? "warning" : "positive",
    },
    {
      id: "net-positions",
      label: "Net places",
      value: formatSigned(summary.netPositions),
      detail: "Places gained minus places lost across every mover",
      icon: "gauge",
      health: summary.netPositions >= 0 ? "positive" : "negative",
    },
    {
      id: "traffic-change",
      label: "Traffic change",
      value: formatSigned(summary.trafficChange),
      unit: "sessions / mo",
      detail: "What the movement was worth at modelled click-through rates",
      icon: "analytics",
      health: summary.trafficChange >= 0 ? "positive" : "negative",
    },
    {
      id: "average-position",
      label: "Average position",
      value: summary.averagePosition.toFixed(1),
      detail: "Across every keyword that ranks",
      icon: "target",
      trend: summary.averagePositionTrend,
    },
    {
      id: "movers",
      label: "Keywords that moved",
      value: String(rows.length),
      detail: `Out of the analysed set, over the ${caption.toLowerCase()}`,
      icon: "activity",
    },
  ];

  return (
    <div className="space-y-4">
      <MetricTileGrid metrics={metrics} />

      <Panel>
        <PanelHeader
          eyebrow="Movement"
          title="Winners and losers"
          description={`Ranking changes over the ${caption.toLowerCase()}, measured from the start of the window against today.`}
          actions={
            <Segmented
              label="Movement window"
              value={range}
              onChange={(next) => {
                onRangeChange(next);
                setExpanded(false);
              }}
              options={DATE_RANGES.map((entry) => ({
                value: entry.id,
                label: entry.label,
                title: entry.caption,
              }))}
            />
          }
        />

        <div className="border-b border-border px-4 py-3 sm:px-5">
          <Segmented
            label="Movement type"
            value={kind}
            onChange={(next) => {
              setKind(next);
              setExpanded(false);
            }}
            options={MOVEMENT_KIND_ORDER.map((entry) => ({
              value: entry,
              label: MOVEMENT_KIND_META[entry].plural,
              count: counts[entry] ?? 0,
              title: MOVEMENT_KIND_META[entry].description,
            }))}
          />
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon={MOVEMENT_KIND_META[kind].icon}
            title={`No ${MOVEMENT_KIND_META[kind].plural.toLowerCase()} in this window`}
            description={
              kind === "lost"
                ? "Nothing dropped out of the top 100 over this window — the set held everything it had."
                : `Nothing in the analysed set qualifies over the ${caption.toLowerCase()}. Try a longer window.`
            }
          />
        ) : (
          <Table caption={`${MOVEMENT_KIND_META[kind].plural} over the ${caption}`}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Keyword</TableHeaderCell>
                <TableHeaderCell>Intent</TableHeaderCell>
                <TableHeaderCell align="right">Was</TableHeaderCell>
                <TableHeaderCell align="right">Now</TableHeaderCell>
                <TableHeaderCell align="right">Change</TableHeaderCell>
                <TableHeaderCell align="right">Volume</TableHeaderCell>
                <TableHeaderCell align="right">Traffic</TableHeaderCell>
                <TableHeaderCell>Significance</TableHeaderCell>
                <TableHeaderCell>Target page</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((row) => (
                <TableRow key={`${row.kind}-${row.keywordId}`}>
                  <TableCell header className="max-w-[280px] min-w-[200px]">
                    <KeywordLink
                      id={row.keywordId}
                      keyword={row.keyword}
                      className="block truncate"
                    />
                    <span className="mt-0.5 block truncate text-[11px] font-normal text-fg-subtle">
                      {row.projectName} · {row.note}
                    </span>
                  </TableCell>
                  <TableCell>
                    <IntentBadge intent={row.intent} short />
                  </TableCell>
                  <TableCell numeric className="text-fg-subtle">
                    {row.previousPosition ?? "—"}
                  </TableCell>
                  <TableCell numeric>
                    <PositionValue position={row.position} />
                  </TableCell>
                  <TableCell numeric>
                    <ChangeValue change={row.change} />
                  </TableCell>
                  <TableCell numeric>
                    <VolumeValue volume={row.volume} />
                  </TableCell>
                  <TableCell
                    numeric
                    className={
                      row.trafficChange >= 0 ? "text-positive" : "text-critical"
                    }
                  >
                    {row.trafficChange >= 0 ? "+" : "−"}
                    {formatCompact(Math.abs(row.trafficChange))}
                  </TableCell>
                  <TableCell>
                    <Badge
                      tone={
                        row.significance === "high"
                          ? "warning"
                          : row.significance === "medium"
                            ? "accent"
                            : "neutral"
                      }
                    >
                      {row.significance}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <TargetUrl url={row.targetUrl} />
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
            shown={PREVIEW}
            total={visible.length}
            noun="keywords"
          />
          <span className="inline-flex items-center gap-1.5">
            <Icon name="info" className="h-3.5 w-3.5" />
            Significance is the traffic the move was worth, not the number of
            places.
          </span>
        </PanelFooter>
      </Panel>
    </div>
  );
}
