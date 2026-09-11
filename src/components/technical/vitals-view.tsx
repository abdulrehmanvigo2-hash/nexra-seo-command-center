"use client";

import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { formatPercent } from "@/lib/format";
import { MODELLED_SOURCE_NOTE } from "@/lib/mock/technical";
import {
  CwvBadge,
  DistributionList,
  NoVitalData,
  ProvenanceTag,
  ScoreBreakdownList,
  ScoreReading,
  ScoreValue,
  VitalValue,
  PageLink,
  toneForScore,
} from "@/components/technical/technical-chrome";
import type { TechnicalFilters as Filters } from "@/components/technical/filters";
import type { TechnicalPage, VitalsSummary } from "@/types/technical";

/**
 * Core Web Vitals across the selection.
 *
 * A page passes only when all three vitals are inside the good band, and fails
 * outright when any one is poor — the assessment's own rule, not an average.
 * Pages with too little traffic to model a field reading are counted and
 * excluded from every rate, because a pass rate over pages nobody measured is
 * not a pass rate.
 *
 * One device profile, not a mobile and desktop pair: this dataset gives no
 * basis for two, and splitting them would be inventing the difference.
 */
export function VitalsView({
  vitals,
  pages,
  onFilter,
}: {
  vitals: VitalsSummary;
  pages: readonly TechnicalPage[];
  onFilter: (patch: Partial<Filters>) => void;
}) {
  if (vitals.total === 0) {
    return (
      <Panel>
        <EmptyState
          icon="gauge"
          title="No pages in this selection"
          description="Clear a filter to bring pages back into scope."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-1">
          <PanelHeader
            eyebrow="Performance"
            title="Core Web Vitals"
            description={`${vitals.passing} of ${vitals.measured} measured URLs pass all three.`}
          />
          <PanelBody className="space-y-4">
            <ScoreReading
              score={vitals.score.score}
              caption="Core Web Vitals score"
              label={`Core Web Vitals: ${vitals.score.score} out of 100`}
              detail={vitals.score.summary}
            />
            <ScoreBreakdownList score={vitals.score} />
          </PanelBody>
          <PanelFooter>
            <span>{formatPercent(vitals.passRate, 0)} pass rate</span>
            <span>{vitals.unmeasured} without field data</span>
          </PanelFooter>
        </Panel>

        <div className="space-y-4 xl:col-span-2">
          <Panel>
            <PanelHeader
              eyebrow="By metric"
              title="Each vital against its thresholds"
              description="Published field thresholds. A page has to clear all three to pass."
              actions={<ProvenanceTag provenance="seeded" />}
            />
            <PanelBody>
              <ul className="grid gap-3 sm:grid-cols-3">
                {vitals.vitals.map((vital) => (
                  <li
                    key={vital.id}
                    className="rounded-md border border-border bg-surface-raised px-3 py-3"
                  >
                    <p className="text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
                      {vital.id.toUpperCase()}
                    </p>
                    <p className="mt-1.5 flex items-baseline gap-1.5">
                      <span className="tabular text-[20px] leading-none font-semibold text-fg">
                        {vital.unit === "ms"
                          ? vital.median >= 1_000
                            ? `${(vital.median / 1_000).toFixed(2)}s`
                            : `${vital.median}ms`
                          : vital.median.toFixed(3)}
                      </span>
                      <span className="text-[11px] text-fg-subtle">median</span>
                    </p>
                    <Meter
                      className="mt-2.5"
                      value={vital.passRate}
                      tone={
                        vital.passRate >= 75
                          ? "positive"
                          : vital.passRate >= 50
                            ? "warning"
                            : "critical"
                      }
                      label={`${vital.label}: ${vital.passRate}% of measured URLs pass`}
                    />
                    <p className="mt-1.5 text-[11px] text-fg-subtle">
                      {formatPercent(vital.passRate, 0)} pass · good at or under{" "}
                      {vital.unit === "ms"
                        ? `${vital.goodThreshold}ms`
                        : vital.goodThreshold}
                    </p>
                    <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">
                      {vital.description}
                    </p>
                    <p className="tabular mt-2 text-[11px] text-fg-subtle">
                      {vital.good} good · {vital.needsWork} needs work ·{" "}
                      {vital.poor} poor
                    </p>
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Distribution"
              title="Pages by verdict"
              description="Selecting a state narrows the whole workspace to those pages."
            />
            <PanelBody className="space-y-3">
              <DistributionList rows={vitals.states} />
              <div className="flex flex-wrap gap-2">
                {vitals.states.map((state) => (
                  <button
                    key={state.id}
                    type="button"
                    onClick={() =>
                      onFilter({ cwv: state.id as Filters["cwv"] })
                    }
                    className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-[11.5px] text-fg-muted transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    Show {state.label.toLowerCase()} ({state.count})
                  </button>
                ))}
              </div>
            </PanelBody>
            <PanelFooter>
              <span>{MODELLED_SOURCE_NOTE}</span>
            </PanelFooter>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          eyebrow="Page by page"
          title="Vitals per URL"
          description="Sorted by whatever the toolbar's sort is set to. Pages with no field reading show a dash rather than a number nobody measured."
        />
        {pages.length === 0 ? (
          <EmptyState
            size="sm"
            icon="search"
            title="No pages match these filters"
            description="Clear a filter to widen the set."
          />
        ) : (
          <Table caption="Core Web Vitals for each published URL">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Page</TableHeaderCell>
                <TableHeaderCell align="right">LCP</TableHeaderCell>
                <TableHeaderCell align="right">INP</TableHeaderCell>
                <TableHeaderCell align="right">CLS</TableHeaderCell>
                <TableHeaderCell>Verdict</TableHeaderCell>
                <TableHeaderCell align="right" className="hidden sm:table-cell">
                  Issues
                </TableHeaderCell>
                <TableHeaderCell align="right">Score</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pages.map((page) => (
                <TableRow key={page.id}>
                  <TableCell header className="max-w-[22rem] min-w-[12rem]">
                    <PageLink
                      pageId={page.id}
                      title={page.title}
                      path={page.path}
                    />
                  </TableCell>
                  <TableCell numeric>
                    {page.vitals.state === "unmeasured" ? (
                      <NoVitalData />
                    ) : (
                      <VitalValue
                        value={page.vitals.lcp}
                        unit="ms"
                        good={vitals.vitals[0].goodThreshold}
                        poor={vitals.vitals[0].poorThreshold}
                      />
                    )}
                  </TableCell>
                  <TableCell numeric>
                    {page.vitals.state === "unmeasured" ? (
                      <NoVitalData />
                    ) : (
                      <VitalValue
                        value={page.vitals.inp}
                        unit="ms"
                        good={vitals.vitals[1].goodThreshold}
                        poor={vitals.vitals[1].poorThreshold}
                      />
                    )}
                  </TableCell>
                  <TableCell numeric>
                    {page.vitals.state === "unmeasured" ? (
                      <NoVitalData />
                    ) : (
                      <VitalValue
                        value={page.vitals.cls}
                        unit=""
                        good={vitals.vitals[2].goodThreshold}
                        poor={vitals.vitals[2].poorThreshold}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <CwvBadge state={page.vitals.state} />
                  </TableCell>
                  <TableCell numeric className="hidden sm:table-cell">
                    {page.issueCount}
                  </TableCell>
                  <TableCell numeric>
                    <ScoreValue
                      score={page.score.score}
                      label="Technical score"
                      tone={toneForScore(page.score.score)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
