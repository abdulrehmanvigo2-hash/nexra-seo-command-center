"use client";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
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
  CompetitorLink,
  IntentBadge,
  OwnerLink,
  PositionValue,
} from "@/components/competitors/competitor-chrome";
import type { IntentBattleground } from "@/types/competitor";

/**
 * Who answers which kind of query.
 *
 * The intents are the product's own — the same six the keyword module
 * classifies against and the content module aligns page formats to. There is
 * no second intent taxonomy here, and the labels come from `INTENT_META`
 * rather than being re-authored.
 *
 * Two readings sit side by side deliberately. Ranking share says who appears;
 * the aligned-page count says whether our pages are the right shape for the
 * query at all. A project can hold a respectable share of an intent with pages
 * that answer it badly, and the mismatch flag is for exactly that case.
 */
export function IntentView({
  rows,
}: {
  rows: readonly IntentBattleground[];
}) {
  if (rows.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="target"
          title="No intents in this selection"
          description="Widen the filters to bring the keyword set back."
        />
      </Panel>
    );
  }

  const mismatched = rows.filter((row) => row.mismatch);

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Intent"
          title="Share of each kind of query"
          description="How much of each intent we appear for, against the rival that appears for most of it."
        />
        <Table caption="Search intents with our share, the leading competitor, and page alignment">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Intent</TableHeaderCell>
              <TableHeaderCell align="right">Terms</TableHeaderCell>
              <TableHeaderCell align="right">Volume</TableHeaderCell>
              <TableHeaderCell align="right">We rank</TableHeaderCell>
              <TableHeaderCell align="right">Top ten</TableHeaderCell>
              <TableHeaderCell align="right">Our avg.</TableHeaderCell>
              <TableHeaderCell align="right">Our share</TableHeaderCell>
              <TableHeaderCell>Leading rival</TableHeaderCell>
              <TableHeaderCell align="right">Their share</TableHeaderCell>
              <TableHeaderCell align="right">Aligned pages</TableHeaderCell>
              <TableHeaderCell>Fit</TableHeaderCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {rows.map((row) => {
              const leader = row.rivals[0];

              return (
                <TableRow key={row.intent}>
                  <TableCell header>
                    <IntentBadge intent={row.intent} />
                  </TableCell>

                  <TableCell numeric>{row.keywordCount}</TableCell>

                  <TableCell numeric>
                    <span
                      className="tabular text-fg-muted"
                      title={`${row.totalVolume.toLocaleString("en-US")} searches a month`}
                    >
                      {formatCompact(row.totalVolume)}
                    </span>
                  </TableCell>

                  <TableCell numeric>{row.ourRanking}</TableCell>

                  <TableCell numeric>{row.ourTopTen}</TableCell>

                  <TableCell numeric>
                    <PositionValue
                      position={
                        row.ourAveragePosition === null
                          ? null
                          : Math.round(row.ourAveragePosition)
                      }
                    />
                  </TableCell>

                  <TableCell numeric>
                    <span className="inline-flex items-center gap-2">
                      <span className="tabular w-10 text-right font-semibold text-fg">
                        {formatPercent(row.ourShare, 0)}
                      </span>
                      <span className="hidden w-12 sm:block">
                        <Meter
                          size="sm"
                          value={row.ourShare}
                          tone="positive"
                          label={`We appear on ${Math.round(row.ourShare)}% of these terms`}
                        />
                      </span>
                    </span>
                  </TableCell>

                  <TableCell className="max-w-[150px]">
                    {leader === undefined ? (
                      <span className="text-[11.5px] text-fg-subtle">
                        No rival ranks here
                      </span>
                    ) : (
                      <CompetitorLink
                        id={leader.competitorId}
                        name={leader.name}
                        className="truncate font-normal text-fg-muted"
                      />
                    )}
                  </TableCell>

                  <TableCell numeric>
                    {leader === undefined ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span className="tabular w-10 text-right text-fg-muted">
                          {formatPercent(leader.share, 0)}
                        </span>
                        <span className="hidden w-12 sm:block">
                          <Meter
                            size="sm"
                            value={leader.share}
                            tone="critical"
                            label={`${leader.name} appears on ${Math.round(leader.share)}% of these terms`}
                          />
                        </span>
                      </span>
                    )}
                  </TableCell>

                  <TableCell numeric>
                    <span
                      className="tabular text-fg-muted"
                      title={`${row.ourAlignedPages} of our ${row.ourPages} pages on this intent are in a format the query asks for`}
                    >
                      {row.ourAlignedPages}
                      <span className="text-fg-subtle"> / {row.ourPages}</span>
                    </span>
                  </TableCell>

                  <TableCell>
                    {row.mismatch ? (
                      <Badge
                        tone="warning"
                        title="Rivals hold this intent, or our pages are the wrong shape for it"
                      >
                        Mismatch
                      </Badge>
                    ) : (
                      <Badge tone="positive" title="We hold our share of this intent">
                        Covered
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <PanelFooter>
          <span>
            Shares are measured over the terms either side ranks for, so both
            columns use the same denominator.
          </span>
          <span>
            Intents are the product&rsquo;s own vocabulary, not a second set
          </span>
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Reading"
          title="What each intent is telling us"
          description="One line per intent, stating who holds it and whether our pages are built for it."
        />
        <PanelBody className="space-y-2.5">
          {rows.map((row) => (
            <div
              key={`note-${row.intent}`}
              className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
                  {INTENT_META[row.intent].label}
                  {row.mismatch && (
                    <Badge tone="warning">Needs attention</Badge>
                  )}
                </span>
                <OwnerLink agent={row.owner} className="text-[11.5px]" />
              </div>
              <p className="mt-1.5 text-[11.5px] leading-snug text-fg-muted">
                {row.note}
              </p>
            </div>
          ))}
        </PanelBody>
        <PanelFooter>
          <span>
            {mismatched.length === 0
              ? "No intent in this selection is mismatched."
              : `${mismatched.length} of ${rows.length} intents need attention.`}
          </span>
        </PanelFooter>
      </Panel>
    </div>
  );
}
