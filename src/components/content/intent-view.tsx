"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter, StackedMeter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Segmented } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { formatCompact, formatPercent } from "@/lib/format";
import { INTENT_META } from "@/lib/mock/keywords";
import {
  ALIGNMENT_META,
  ALIGNMENT_ORDER,
  FORMAT_FOR_INTENT,
  FORMAT_META,
} from "@/lib/mock/content";
import { ListExpander } from "@/components/agents/list-expander";
import {
  AlignmentBadge,
  ContentLink,
  FormatBadge,
  IntentBadge,
  PageUrl,
} from "@/components/content/content-chrome";
import type {
  ContentRecord,
  IntentAlignment,
  IntentAlignmentRow,
} from "@/types/content";

/**
 * Whether the pages answer the question being asked.
 *
 * Two readings. The table at the top asks it per intent: is the commercial
 * demand being served by comparisons, or by landing pages that never reach a
 * recommendation? The list below asks it per page, so the answer is something
 * to act on rather than something to note.
 *
 * Alignment is judged against the primary keyword's intent and the format the
 * page actually is. A page with no keyword mapped to it cannot be judged at
 * all, and is reported as mismatched with that as the reason — an unmapped
 * page is a real problem, not an unknown one.
 */

const PREVIEW = 12;

export function IntentView({
  rows,
  records,
}: {
  rows: readonly IntentAlignmentRow[];
  records: readonly ContentRecord[];
}) {
  const [alignment, setAlignment] = useState<IntentAlignment | "all">(
    "mismatched",
  );
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: records.length };
    for (const record of records) {
      tally[record.intentAlignment] = (tally[record.intentAlignment] ?? 0) + 1;
    }
    return tally;
  }, [records]);

  const visible = useMemo(
    () =>
      [
        ...(alignment === "all"
          ? records
          : records.filter((record) => record.intentAlignment === alignment)),
      ].sort((a, b) => b.totalVolume - a.totalVolume),
    [records, alignment],
  );

  const shown = expanded ? visible : visible.slice(0, PREVIEW);

  const totalPieces = rows.reduce((carry, row) => carry + row.pieces, 0);
  const totalAligned = rows.reduce((carry, row) => carry + row.aligned, 0);

  return (
    <div className="space-y-4">
      <Panel>
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <SectionHeader
            eyebrow="Intent"
            title="Is the demand being answered in kind"
            description="What each intent is worth, how many pieces serve it, and how many of those are the right shape."
            actions={
              <span className="text-[11.5px] text-fg-subtle">
                {totalPieces === 0
                  ? "No pieces in this selection"
                  : `${formatPercent(
                      Math.round((totalAligned / totalPieces) * 100),
                      0,
                    )} of pieces aligned`}
              </span>
            }
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon="target"
            title="Nothing to align"
            description="No content in the current selection carries a search intent."
          />
        ) : (
          <Table caption="Search intent alignment across the inventory">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Intent</TableHeaderCell>
                <TableHeaderCell>Format it calls for</TableHeaderCell>
                <TableHeaderCell align="right">Keywords</TableHeaderCell>
                <TableHeaderCell align="right">Pieces</TableHeaderCell>
                <TableHeaderCell align="right">Volume</TableHeaderCell>
                <TableHeaderCell>Alignment</TableHeaderCell>
                <TableHeaderCell align="right">Aligned</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.intent}>
                  <TableCell header>
                    <IntentBadge intent={row.intent} />
                    <span className="mt-1 block text-[11px] font-normal text-fg-subtle">
                      {INTENT_META[row.intent].description}
                    </span>
                  </TableCell>

                  <TableCell>
                    <FormatBadge format={row.expectedFormat} />
                  </TableCell>

                  <TableCell numeric>{row.keywordCount}</TableCell>
                  <TableCell numeric>{row.pieces}</TableCell>
                  <TableCell numeric>{formatCompact(row.volume)}</TableCell>

                  <TableCell className="min-w-[180px]">
                    {row.pieces === 0 ? (
                      <span className="text-[11.5px] text-fg-subtle">
                        No pieces serve this intent
                      </span>
                    ) : (
                      <>
                        <StackedMeter
                          label={`${INTENT_META[row.intent].label}: ${row.aligned} aligned, ${row.partial} partial, ${row.mismatched} mismatched`}
                          segments={(
                            [
                              {
                                id: "aligned",
                                value: row.aligned,
                                tone: "positive",
                              },
                              {
                                id: "partial",
                                value: row.partial,
                                tone: "warning",
                              },
                              {
                                id: "mismatched",
                                value: row.mismatched,
                                tone: "critical",
                              },
                            ] as const
                          ).filter((segment) => segment.value > 0)}
                        />
                        <span className="tabular mt-1.5 block text-[11px] text-fg-subtle">
                          {row.aligned} aligned · {row.partial} partial ·{" "}
                          {row.mismatched} mismatched
                        </span>
                      </>
                    )}
                  </TableCell>

                  <TableCell numeric className="font-semibold text-fg">
                    {row.pieces === 0 ? "—" : formatPercent(row.alignmentRate, 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <PanelFooter>
          <span>
            A format is aligned where it is the one that intent asks for,
            partial where it still serves it, and mismatched where it answers a
            different question.
          </span>
        </PanelFooter>
      </Panel>

      <Panel>
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <SectionHeader
            eyebrow="By page"
            title="Where the format is wrong"
            description="The pieces whose shape does not match what their primary keyword is asking for."
            actions={
              <Segmented
                label="Filter pages by intent alignment"
                value={alignment}
                onChange={(next) => {
                  setAlignment(next);
                  setExpanded(false);
                }}
                options={[
                  { value: "all" as const, label: "All", count: counts.all },
                  ...ALIGNMENT_ORDER.filter(
                    (entry) => (counts[entry] ?? 0) > 0,
                  ).map((entry) => ({
                    value: entry,
                    label: ALIGNMENT_META[entry].label,
                    count: counts[entry],
                    title: ALIGNMENT_META[entry].description,
                  })),
                ]}
              />
            }
          />
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon="check"
            title="Nothing in this state"
            description="No piece in the current selection has this alignment."
            action={
              alignment !== "all" ? (
                <Button icon="close" onClick={() => setAlignment("all")}>
                  Show every piece
                </Button>
              ) : undefined
            }
          />
        ) : (
          <PanelBody>
            <ul className="space-y-2">
              {shown.map((record) => (
                <li
                  key={record.id}
                  className="rounded-md border border-border bg-surface-raised px-3.5 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <div className="min-w-0">
                      <ContentLink
                        id={record.id}
                        title={record.title}
                        className="block truncate text-[13px]"
                      />
                      <PageUrl
                        url={record.url}
                        stage={record.stage}
                        className="mt-0.5"
                      />
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <IntentBadge intent={record.primaryIntent} />
                      <Icon
                        name="arrow-right"
                        className="h-3.5 w-3.5 text-fg-subtle"
                      />
                      <FormatBadge format={record.format} />
                      <AlignmentBadge alignment={record.intentAlignment} />
                    </div>
                  </div>

                  <p className="mt-2 text-[11.5px] leading-relaxed text-fg-subtle">
                    {record.intentNote}
                  </p>

                  {record.intentAlignment !== "aligned" && (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted">
                      <Icon
                        name="flag"
                        className="h-3.5 w-3.5 shrink-0 text-accent"
                      />
                      {record.primaryKeyword === null
                        ? "Map a keyword to it before deciding what shape it should be."
                        : `Suggested: rebuild as a ${FORMAT_META[
                            FORMAT_FOR_INTENT[record.primaryIntent]
                          ].label.toLowerCase()}, or move the query to a page that already is one.`}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
                    <span className="tabular">
                      {formatCompact(record.totalVolume)} searches / mo
                    </span>
                    <span>{record.projectName}</span>
                    <span className="min-w-0 truncate">
                      {record.clusterName}
                    </span>
                  </div>

                  <Meter
                    className="mt-2"
                    size="sm"
                    value={
                      record.intentAlignment === "aligned"
                        ? 100
                        : record.intentAlignment === "partial"
                          ? 58
                          : 18
                    }
                    tone={
                      record.intentAlignment === "aligned"
                        ? "positive"
                        : record.intentAlignment === "partial"
                          ? "warning"
                          : "critical"
                    }
                    label={`Intent match contributes ${
                      record.intentAlignment === "aligned"
                        ? 100
                        : record.intentAlignment === "partial"
                          ? 58
                          : 18
                    } of 100 to this page's content score`}
                  />
                </li>
              ))}
            </ul>
          </PanelBody>
        )}

        <PanelFooter>
          <ListExpander
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            shown={PREVIEW}
            total={visible.length}
            noun="pieces"
          />
          <span className="inline-flex items-center gap-1.5">
            <Icon name="info" className="h-3.5 w-3.5" />
            Intent match carries 16% of the content score.
          </span>
        </PanelFooter>
      </Panel>
    </div>
  );
}
