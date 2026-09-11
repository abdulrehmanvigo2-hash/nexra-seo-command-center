"use client";

import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
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
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import { MODELLED_SOURCE_NOTE } from "@/lib/mock/competitors";
import {
  CompetitorLink,
  CompetitorTypeBadge,
  DomainText,
  ProvenanceTag,
  ThreatBadge,
} from "@/components/competitors/competitor-chrome";
import type { CompareDimension, CompareResult } from "@/types/competitor";

/** The most columns the table stays readable in. */
export const COMPARE_LIMIT = 4;

/**
 * Us against a chosen set of rivals.
 *
 * The constraint that makes this useful rather than decorative is that every
 * row is measured the same way on both sides. Where a dimension genuinely has
 * no reading for us — a rival's modelled authority, the threat it poses — the
 * cell is left empty and says why, rather than being filled with a number that
 * would invite a comparison that does not exist.
 *
 * The best value in each row is marked, which is the only way a wide table of
 * mixed units is readable at a glance. "Best" respects direction: a lower
 * average position wins its row, a higher visibility wins its own.
 *
 * Comparison is per project. Rivals in different markets share no denominator,
 * and putting them side by side would compare two unrelated fights.
 */
export function CompareView({
  comparison,
  projects,
  projectId,
  onProjectChange,
  selected,
  onToggle,
  onClear,
  available,
}: {
  comparison: CompareResult | null;
  projects: readonly { readonly id: string; readonly name: string }[];
  projectId: string;
  onProjectChange: (id: string) => void;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
  /** Every competitor in the chosen project, for the picker. */
  available: readonly {
    readonly id: string;
    readonly name: string;
    readonly domain: string;
    readonly threatScore: number;
  }[];
}) {
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Compare"
          title="Pick a project, then up to four rivals"
          description="Rivals compete inside a project, so the comparison is scoped to one. Every dimension below is measured the same way for both sides."
          actions={
            selected.size > 0 ? (
              <Button icon="close" onClick={onClear}>
                Clear selection
              </Button>
            ) : undefined
          }
        />
        <PanelBody className="space-y-3.5">
          <div className="max-w-xs">
            <label
              htmlFor="compare-project"
              className="text-[11.5px] font-medium text-fg-muted"
            >
              Project
            </label>
            <Select
              id="compare-project"
              className="mt-1.5"
              size="sm"
              value={projectId}
              onChange={(event) => onProjectChange(event.target.value)}
              options={projects.map((project) => ({
                value: project.id,
                label: project.name,
              }))}
            />
          </div>

          {available.length === 0 ? (
            <p className="text-[12.5px] text-fg-subtle">
              No competitors are tracked against this project.
            </p>
          ) : (
            <div
              role="group"
              aria-label="Choose competitors to compare"
              className="flex flex-wrap gap-2"
            >
              {available.map((entry) => {
                const active = selected.has(entry.id);
                const full = !active && selected.size >= COMPARE_LIMIT;

                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={active}
                    disabled={full}
                    onClick={() => onToggle(entry.id)}
                    title={
                      full
                        ? `Up to ${COMPARE_LIMIT} rivals at a time — remove one first.`
                        : `${entry.domain} — threat ${entry.threatScore} of 100`
                    }
                    className={cn(
                      "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] font-medium transition-colors",
                      "disabled:cursor-not-allowed disabled:opacity-40",
                      active
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border-strong bg-surface-raised text-fg-muted hover:bg-surface-hover",
                    )}
                  >
                    <Icon
                      name={active ? "check" : "plus"}
                      className="h-3.5 w-3.5 shrink-0"
                    />
                    {entry.name}
                    <span className="tabular text-[11px] opacity-70">
                      {entry.threatScore}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </PanelBody>
        <PanelFooter>
          <span>
            {selected.size === 0
              ? `Select up to ${COMPARE_LIMIT} rivals to build the comparison.`
              : `${selected.size} of ${COMPARE_LIMIT} selected.`}
          </span>
          <span>{MODELLED_SOURCE_NOTE}</span>
        </PanelFooter>
      </Panel>

      {comparison === null || comparison.competitors.length === 0 ? (
        <Panel>
          <EmptyState
            icon="split"
            title="Nothing to compare yet"
            description="Pick at least one rival above. The table will put it beside this project on every dimension both sides can be measured on."
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {comparison.competitors.map((record) => (
              <Panel as="article" key={record.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <CompetitorLink id={record.id} name={record.name} />
                    <DomainText domain={record.domain} />
                  </span>
                  <ThreatBadge level={record.threatLevel} />
                </div>
                <div className="mt-2.5">
                  <CompetitorTypeBadge type={record.type} />
                </div>
                <p className="mt-2.5 text-[11.5px] leading-snug text-fg-muted">
                  {record.headline}
                </p>
              </Panel>
            ))}
          </div>

          <Panel>
            <PanelHeader
              eyebrow="Side by side"
              title={`${comparison.ourName} against ${comparison.competitors.length} ${comparison.competitors.length === 1 ? "rival" : "rivals"}`}
              description="The best reading in each row is marked. An empty cell means the dimension has no meaning for that side, not that the value is zero."
            />

            <Table caption="Comparison of this project against the selected competitors">
              <TableHead>
                <TableRow>
                  <TableHeaderCell className="min-w-[180px]">
                    Dimension
                  </TableHeaderCell>
                  <TableHeaderCell align="right">
                    <span className="text-accent">{comparison.ourName}</span>
                  </TableHeaderCell>
                  {comparison.competitors.map((record) => (
                    <TableHeaderCell key={record.id} align="right">
                      {record.name}
                    </TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>

              <TableBody>
                {comparison.dimensions.map((dimension) => {
                  const best = bestOf(dimension, comparison.competitors.map((r) => r.id));

                  return (
                    <TableRow key={dimension.id}>
                      <TableCell header className="max-w-[260px]">
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex items-center gap-2">
                            {dimension.label}
                            <ProvenanceTag provenance={dimension.provenance} />
                          </span>
                          <span className="text-[11px] leading-snug font-normal text-fg-subtle">
                            {dimension.description}
                          </span>
                        </span>
                      </TableCell>

                      <Cell
                        value={dimension.ours}
                        dimension={dimension}
                        best={best === "ours"}
                        ours
                      />

                      {comparison.competitors.map((record) => (
                        <Cell
                          key={record.id}
                          value={dimension.values[record.id] ?? null}
                          dimension={dimension}
                          best={best === record.id}
                        />
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <PanelFooter>
              <span>
                Our footprint is counted over the same keyword set as theirs,
                and our cluster strength uses the same function.
              </span>
              <span>{comparison.projectName}</span>
            </PanelFooter>
          </Panel>
        </>
      )}
    </div>
  );
}

/** Which column holds the best reading, or null where nothing can win. */
function bestOf(
  dimension: CompareDimension,
  competitorIds: readonly string[],
): string | null {
  const entries: { key: string; value: number }[] = [];
  if (dimension.ours !== null) {
    entries.push({ key: "ours", value: dimension.ours });
  }
  for (const id of competitorIds) {
    const value = dimension.values[id];
    if (value !== null && value !== undefined) entries.push({ key: id, value });
  }

  if (entries.length < 2) return null;

  const sorted = [...entries].sort((a, b) =>
    dimension.lowerIsBetter ? a.value - b.value : b.value - a.value,
  );

  // A tie has no winner worth marking.
  if (sorted[0].value === sorted[1].value) return null;
  return sorted[0].key;
}

function Cell({
  value,
  dimension,
  best,
  ours = false,
}: {
  value: number | null;
  dimension: CompareDimension;
  best: boolean;
  ours?: boolean;
}) {
  if (value === null) {
    return (
      <TableCell numeric>
        <span
          className="text-fg-subtle"
          title={
            ours
              ? "This dimension describes a competitor, so it has no reading for us."
              : "No reading for this competitor."
          }
        >
          —
        </span>
      </TableCell>
    );
  }

  const text =
    dimension.format === "percent"
      ? formatPercent(value)
      : dimension.format === "compact"
        ? formatCompact(value)
        : dimension.format === "position"
          ? value.toFixed(1)
          : formatNumber(value);

  return (
    <TableCell numeric className={cn(ours && "bg-accent-soft/30")}>
      <span className="inline-flex items-center justify-end gap-2">
        {dimension.format === "score" && (
          <span className="hidden w-12 sm:block">
            <Meter
              size="sm"
              value={value}
              tone={ours ? "accent" : "warning"}
              label={`${dimension.label} ${value} of 100`}
            />
          </span>
        )}
        <span
          className={cn(
            "tabular",
            best ? "font-semibold text-positive" : "text-fg-muted",
          )}
        >
          {text}
        </span>
        {best && (
          <>
            <Icon
              name="check"
              className="h-3.5 w-3.5 shrink-0 text-positive"
              aria-hidden="true"
            />
            <span className="sr-only">best in this row</span>
          </>
        )}
      </span>
    </TableCell>
  );
}
