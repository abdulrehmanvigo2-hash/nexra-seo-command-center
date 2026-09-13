"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelFooter } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { formatCompact } from "@/lib/format";
import { MODELLED_SOURCE_NOTE } from "@/lib/mock/competitors";
import {
  CompetitorLink,
  CompetitorPageUrl,
  IntentBadge,
  OurPageCell,
  OwnerLink,
  PositionValue,
  ProvenanceTag,
  ScoreValue,
  ThreatBadge,
  TrafficValue,
  VolumeValue,
} from "@/components/competitors/competitor-chrome";
import { SortableHeader } from "@/components/ui/sortable-header";
import { Pagination } from "@/components/keywords/pagination";
import {
  PAGE_SORT_OPTIONS,
  type PageSort,
} from "@/components/competitors/sorting";
import type { CompetitorPage } from "@/types/competitor";

/**
 * The pages a rival actually ranks with.
 *
 * Modelled rather than crawled — this product does not fetch anybody's site
 * (CLAUDE.md §4) — so the provenance is stated at the top of the panel rather
 * than buried. What is not modelled is the evidence: the terms each page
 * ranks for, their volumes, and our own position on them are all canonical.
 *
 * Every page names the page of ours competing with it and what to do about it,
 * because "they have a strong page" is only useful next to "and ours is this
 * one, scoring this".
 */
export function PagesView({
  pages,
  sort,
  onSort,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  pages: readonly CompetitorPage[];
  sort: { key: PageSort; desc: boolean };
  onSort: (key: PageSort) => void;
  page: number;
  pageSize: number;
  onPageChange: (value: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(pages.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = pages.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  if (pages.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="pages"
          title="No competitor pages in this selection"
          description="No rival in the current filters ranks for anything, so there are no pages to model."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-start gap-3 border-b border-border bg-surface-raised px-4 py-3 sm:px-5">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-fg-muted">
            These pages are modelled from the terms each rival ranks for, not
            fetched from their sites. The terms, volumes, and our own positions
            are measured; the URL, the title, the word count, and the depth are
            deterministic estimates.
          </p>
          <ProvenanceTag provenance="seeded" className="mt-0.5" />
        </div>

        <Table caption="Competitor pages with keyword footprint, threat, and our competing page">
          <TableHead>
            <TableRow>
              <SortableHeader
                label="Page"
                sortKey="title"
                sort={sort}
                onSort={onSort}
                options={PAGE_SORT_OPTIONS}
              />
              <TableHeaderCell>Competitor</TableHeaderCell>
              <TableHeaderCell>Cluster</TableHeaderCell>
              <TableHeaderCell>Intent</TableHeaderCell>
              <SortableHeader
                label="Terms"
                sortKey="keywords"
                align="right"
                sort={sort}
                onSort={onSort}
                options={PAGE_SORT_OPTIONS}
              />
              <SortableHeader
                label="Volume"
                sortKey="volume"
                align="right"
                sort={sort}
                onSort={onSort}
                options={PAGE_SORT_OPTIONS}
              />
              <SortableHeader
                label="Best pos."
                sortKey="position"
                align="right"
                sort={sort}
                onSort={onSort}
                options={PAGE_SORT_OPTIONS}
              />
              <SortableHeader
                label="Traffic"
                sortKey="traffic"
                align="right"
                sort={sort}
                onSort={onSort}
                options={PAGE_SORT_OPTIONS}
              />
              <SortableHeader
                label="Depth"
                sortKey="depth"
                align="right"
                sort={sort}
                onSort={onSort}
                options={PAGE_SORT_OPTIONS}
              />
              <SortableHeader
                label="Strength"
                sortKey="strength"
                align="right"
                sort={sort}
                onSort={onSort}
                options={PAGE_SORT_OPTIONS}
              />
              <SortableHeader
                label="Threat"
                sortKey="threat"
                align="right"
                sort={sort}
                onSort={onSort}
                options={PAGE_SORT_OPTIONS}
              />
              <TableHeaderCell>Our page</TableHeaderCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {rows.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell header className="min-w-[220px] max-w-[280px]">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate" title={entry.title}>
                      {entry.title}
                    </span>
                    <CompetitorPageUrl url={entry.url} />
                  </span>
                </TableCell>

                <TableCell className="max-w-[140px]">
                  <CompetitorLink
                    id={entry.competitorId}
                    name={entry.competitorName}
                    className="truncate font-normal text-fg-muted"
                  />
                </TableCell>

                <TableCell className="max-w-[150px]">
                  <Link
                    href={`/keywords/clusters/${entry.clusterId}`}
                    className="block truncate text-fg-muted transition-colors hover:text-accent"
                    title={entry.clusterName}
                  >
                    {entry.clusterName}
                  </Link>
                </TableCell>

                <TableCell>
                  <IntentBadge intent={entry.intent} short />
                </TableCell>

                <TableCell numeric>
                  <span
                    className="tabular text-fg-muted"
                    title={entry.topKeywords
                      .map(
                        (keyword) => `${keyword.keyword} — position ${keyword.position}`,
                      )
                      .join("\n")}
                  >
                    {entry.keywordCount}
                  </span>
                </TableCell>

                <TableCell numeric>
                  <VolumeValue volume={entry.totalVolume} />
                </TableCell>

                <TableCell numeric>
                  <PositionValue position={entry.bestPosition} />
                </TableCell>

                <TableCell numeric>
                  <TrafficValue sessions={entry.estimatedTraffic} />
                </TableCell>

                <TableCell numeric>
                  <span
                    className="tabular text-fg-muted"
                    title={`Modelled at about ${formatCompact(entry.wordCount)} words`}
                  >
                    {entry.contentDepth}
                  </span>
                </TableCell>

                <TableCell numeric>
                  <ScoreValue score={entry.strength} label="Page strength" />
                </TableCell>

                <TableCell numeric>
                  <span className="inline-flex items-center gap-2">
                    <ThreatBadge level={entry.threatLevel} />
                    <span className="tabular w-6 text-right font-semibold text-fg">
                      {entry.threatScore}
                    </span>
                  </span>
                </TableCell>

                <TableCell className="max-w-[200px]">
                  <OurPageCell
                    contentId={entry.ourContentId}
                    title={entry.ourContentTitle}
                    score={entry.ourScore}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Pagination
          page={currentPage}
          pageSize={pageSize}
          total={pages.length}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          noun="pages"
        />
      </Panel>

      <Panel>
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <h3 className="text-[14px] font-semibold tracking-tight text-fg">
            The pages worth answering first
          </h3>
          <p className="mt-1 text-[12.5px] text-fg-muted">
            The five biggest threats in this selection, with the response each
            one calls for.
          </p>
        </div>
        <div className="space-y-2.5 px-4 py-4 sm:px-5">
          {[...pages]
            .sort((a, b) => b.threatScore - a.threatScore)
            .slice(0, 5)
            .map((entry) => (
              <div
                key={`response-${entry.id}`}
                className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[12.5px] font-medium text-fg">
                      {entry.title}
                    </span>
                    <CompetitorPageUrl url={entry.url} />
                  </span>
                  <ThreatBadge
                    level={entry.threatLevel}
                    score={entry.threatScore}
                  />
                </div>
                <p className="mt-2 text-[11.5px] leading-snug text-fg-muted">
                  {entry.response}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
                  <span>
                    {entry.keywordCount} terms ·{" "}
                    {formatCompact(entry.totalVolume)} searches / mo
                  </span>
                  <OwnerLink agent={entry.owner} className="text-[11px]" />
                </div>
              </div>
            ))}
        </div>
        <PanelFooter>
          <span>{MODELLED_SOURCE_NOTE}</span>
        </PanelFooter>
      </Panel>
    </div>
  );
}
