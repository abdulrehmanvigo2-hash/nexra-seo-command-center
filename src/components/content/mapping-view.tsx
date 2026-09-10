"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
import { formatCompact } from "@/lib/format";
import { MAPPING_META, MAPPING_ORDER } from "@/lib/mock/content";
import { ListExpander } from "@/components/agents/list-expander";
import {
  ContentLink,
  IntentBadge,
  KeywordLink,
  MappingBadge,
  PageUrl,
  PositionValue,
  StageBadge,
  VolumeValue,
} from "@/components/content/content-chrome";
import type {
  ContentRecord,
  KeywordMappingRow,
  MappingQuality,
} from "@/types/content";

/**
 * Which page serves which query, and where that breaks down.
 *
 * Two directions, because the mapping fails in two ways. A keyword with
 * nothing live behind it is work that has not been done; a page with no
 * keyword behind it is work that was done without a decision. Both are listed,
 * and the second is easy to miss on a keyword-first screen — which is why it
 * gets its own panel rather than a footnote.
 */

const PREVIEW = 15;

export function MappingView({
  rows,
  unmappedPages,
  onOpenUnmapped,
}: {
  rows: readonly KeywordMappingRow[];
  /** Live pages with no keyword mapped to them. */
  unmappedPages: readonly ContentRecord[];
  /** Applies the "no keyword mapped" flag on the inventory. */
  onOpenUnmapped: () => void;
}) {
  const [quality, setQuality] = useState<MappingQuality | "all">("all");
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: rows.length };
    for (const row of rows) tally[row.quality] = (tally[row.quality] ?? 0) + 1;
    return tally;
  }, [rows]);

  const visible = useMemo(
    () =>
      quality === "all"
        ? rows
        : rows.filter((row) => row.quality === quality),
    [rows, quality],
  );

  const shown = expanded ? visible : visible.slice(0, PREVIEW);

  return (
    <div className="space-y-4">
      <Panel>
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <SectionHeader
            eyebrow="Mapping"
            title="Keyword to content"
            description="Every tracked keyword and the piece serving it, so nothing is being chased without a page behind it."
            actions={
              <Segmented
                label="Filter the mapping by quality"
                value={quality}
                onChange={(next) => {
                  setQuality(next);
                  setExpanded(false);
                }}
                options={[
                  { value: "all" as const, label: "All", count: counts.all },
                  ...MAPPING_ORDER.filter(
                    (entry) => (counts[entry] ?? 0) > 0,
                  ).map((entry) => ({
                    value: entry,
                    label: MAPPING_META[entry].label,
                    count: counts[entry],
                    title: MAPPING_META[entry].description,
                  })),
                ]}
              />
            }
          />
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon="keywords"
            title="No keywords match this filter"
            description="Nothing in the current selection maps this way."
            action={
              quality !== "all" ? (
                <Button icon="close" onClick={() => setQuality("all")}>
                  Show every mapping
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table caption="Keywords and the content serving them">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Keyword</TableHeaderCell>
                <TableHeaderCell>Intent</TableHeaderCell>
                <TableHeaderCell align="right">Volume</TableHeaderCell>
                <TableHeaderCell align="right">Position</TableHeaderCell>
                <TableHeaderCell>Mapping</TableHeaderCell>
                <TableHeaderCell>Serving content</TableHeaderCell>
                <TableHeaderCell>Stage</TableHeaderCell>
                <TableHeaderCell>Note</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((row) => (
                <TableRow key={row.keywordId}>
                  <TableCell header className="max-w-[260px] min-w-[190px]">
                    <KeywordLink
                      id={row.keywordId}
                      keyword={row.keyword}
                      className="block truncate"
                    />
                    <span className="mt-0.5 block truncate text-[11px] font-normal text-fg-subtle">
                      {row.projectName} ·{" "}
                      <Link
                        href={`/keywords/clusters/${row.clusterId}`}
                        className="transition-colors hover:text-accent"
                      >
                        {row.clusterName}
                      </Link>
                    </span>
                  </TableCell>

                  <TableCell>
                    <IntentBadge intent={row.intent} short />
                  </TableCell>

                  <TableCell numeric>
                    <VolumeValue volume={row.volume} />
                  </TableCell>

                  <TableCell numeric>
                    <PositionValue position={row.position} />
                  </TableCell>

                  <TableCell>
                    <MappingBadge quality={row.quality} />
                  </TableCell>

                  <TableCell className="max-w-[240px] min-w-[180px]">
                    {row.contentId === null ? (
                      <span className="text-[11.5px] text-fg-subtle">
                        Nothing
                      </span>
                    ) : (
                      <>
                        <ContentLink
                          id={row.contentId}
                          title={row.contentTitle ?? "Untitled"}
                          className="block truncate text-[12.5px]"
                        />
                        <PageUrl
                          url={row.contentUrl}
                          className="mt-0.5"
                        />
                      </>
                    )}
                  </TableCell>

                  <TableCell>
                    {row.stage ? <StageBadge stage={row.stage} short /> : "—"}
                  </TableCell>

                  <TableCell className="max-w-[280px]">
                    <span className="block text-[11.5px] leading-snug text-fg-subtle">
                      {row.note}
                    </span>
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
            A split keyword has more than one of our pages ranking for it.
          </span>
        </PanelFooter>
      </Panel>

      <Panel>
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <SectionHeader
            eyebrow="The other direction"
            title="Pages with no keyword"
            description="Live pages that nothing targets. They may still be earning, but nothing here decides what they are for."
            actions={
              unmappedPages.length > 0 ? (
                <Button icon="filter" onClick={onOpenUnmapped}>
                  Show in the inventory
                </Button>
              ) : undefined
            }
          />
        </div>

        {unmappedPages.length === 0 ? (
          <EmptyState
            icon="check"
            size="sm"
            title="Every live page has a keyword"
            description="Nothing in the current selection is published without a query behind it."
          />
        ) : (
          <PanelBody>
            <ul className="grid gap-2 md:grid-cols-2">
              {unmappedPages.map((record) => (
                <li
                  key={record.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-raised px-3 py-2.5"
                >
                  <span className="min-w-0">
                    <ContentLink
                      id={record.id}
                      title={record.title}
                      className="block truncate text-[12.5px]"
                    />
                    <PageUrl url={record.url} className="mt-0.5" />
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {record.role === "pillar" && (
                      <Badge tone="accent">Pillar</Badge>
                    )}
                    <span
                      className="tabular text-[11px] text-fg-subtle"
                      title="Links into this page"
                    >
                      {record.internalLinksIn} in
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </PanelBody>
        )}

        <PanelFooter>
          <span>
            {unmappedPages.length}{" "}
            {unmappedPages.length === 1 ? "page" : "pages"} with nothing mapped
            to them.
          </span>
          <span>
            Combined reach of the mapped set:{" "}
            {formatCompact(
              rows.reduce((carry, row) => carry + row.volume, 0),
            )}{" "}
            searches / mo
          </span>
        </PanelFooter>
      </Panel>
    </div>
  );
}
