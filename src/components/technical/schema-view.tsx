"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { Meter } from "@/components/ui/meter";
import { formatPercent } from "@/lib/format";
import { MODELLED_SOURCE_NOTE } from "@/lib/mock/technical";
import {
  DistributionList,
  PageLink,
  ProvenanceTag,
  SchemaBadge,
  ScoreBreakdownList,
  ScoreReading,
} from "@/components/technical/technical-chrome";
import type { TechnicalFilters as Filters } from "@/components/technical/filters";
import type { SchemaSummary, TechnicalPage } from "@/types/technical";

/**
 * Structured data across the selection.
 *
 * Types are counted against what each page's format actually calls for, so
 * "missing" always means a type the page should be carrying. A clinic page is
 * never reported as missing Product markup, because it was never going to have
 * any — a report that counted it that way would be manufacturing findings.
 *
 * Validity here is modelled, not checked. Nothing in this milestone runs a
 * rich-results test or reads a search console.
 */
export function SchemaView({
  schema,
  pages,
  onFilter,
}: {
  schema: SchemaSummary;
  pages: readonly TechnicalPage[];
  onFilter: (patch: Partial<Filters>) => void;
}) {
  if (schema.total === 0) {
    return (
      <Panel>
        <EmptyState
          icon="layers"
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
            eyebrow="Structured data"
            title="Markup coverage"
            description={`${schema.complete} of ${schema.total} URLs carry every type their format calls for.`}
          />
          <PanelBody className="space-y-4">
            <ScoreReading
              score={schema.score.score}
              caption="Structured data score"
              label={`Structured data: ${schema.score.score} out of 100`}
              detail={schema.score.summary}
            />
            <ScoreBreakdownList score={schema.score} />
          </PanelBody>
          <PanelFooter>
            <span>{formatPercent(schema.coverage, 0)} complete</span>
            <span>{schema.missing} with none</span>
          </PanelFooter>
        </Panel>

        <div className="space-y-4 xl:col-span-2">
          <Panel>
            <PanelHeader
              eyebrow="State"
              title="Pages by markup state"
              description="Selecting a state narrows the whole workspace to those pages."
            />
            <PanelBody className="space-y-3">
              <DistributionList rows={schema.states} />
              <div className="flex flex-wrap gap-2">
                {schema.states.map((state) => (
                  <button
                    key={state.id}
                    type="button"
                    onClick={() =>
                      onFilter({ schema: state.id as Filters["schema"] })
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

          <Panel>
            <PanelHeader
              eyebrow="By type"
              title="Coverage per schema type"
              description="Counted only against the pages whose format calls for the type."
              actions={<ProvenanceTag provenance="derived" />}
            />
            <PanelBody>
              {schema.types.length === 0 ? (
                <p className="text-[12px] text-fg-subtle">
                  No page in this selection calls for structured data.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {schema.types.map((row) => (
                    <li key={row.type} className="min-w-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="font-mono text-[12px] font-medium text-fg">
                          {row.type}
                        </span>
                        <span className="tabular shrink-0 text-[11.5px] text-fg-subtle">
                          {row.present} present · {row.missing} missing
                          {row.invalid > 0 && (
                            <span className="text-critical">
                              {" "}
                              · {row.invalid} invalid
                            </span>
                          )}
                        </span>
                      </div>
                      <Meter
                        className="mt-1.5"
                        size="sm"
                        value={row.coverage}
                        tone={
                          row.coverage >= 75
                            ? "positive"
                            : row.coverage >= 45
                              ? "warning"
                              : "critical"
                        }
                        label={`${row.type}: present on ${row.coverage}% of the pages that should carry it`}
                      />
                      <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
                        {row.description}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          eyebrow="Page by page"
          title="Markup per URL"
          description="What each page carries against what its format expects."
        />
        {pages.length === 0 ? (
          <EmptyState
            size="sm"
            icon="search"
            title="No pages match these filters"
            description="Clear a filter to widen the set."
          />
        ) : (
          <Table caption="Structured data on each published URL">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Page</TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell">
                  Format
                </TableHeaderCell>
                <TableHeaderCell>State</TableHeaderCell>
                <TableHeaderCell>Types present</TableHeaderCell>
                <TableHeaderCell align="right" className="hidden lg:table-cell">
                  Types
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pages.map((page) => (
                <TableRow key={page.id}>
                  <TableCell header className="max-w-[20rem] min-w-[12rem]">
                    <PageLink
                      pageId={page.id}
                      title={page.title}
                      path={page.path}
                    />
                  </TableCell>
                  <TableCell className="hidden capitalize sm:table-cell">
                    {page.format}
                  </TableCell>
                  <TableCell>
                    <SchemaBadge state={page.schemaState} />
                  </TableCell>
                  <TableCell className="max-w-[22rem]">
                    {page.schemaTypes.length === 0 ? (
                      <span className="text-fg-subtle">None</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {page.schemaTypes.map((type) => (
                          <span
                            key={type}
                            className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10.5px] text-fg-subtle"
                          >
                            {type}
                          </span>
                        ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell numeric className="hidden lg:table-cell">
                    {page.schemaTypes.length}
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
