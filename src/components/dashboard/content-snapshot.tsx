"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import type {
  ContentBucketId,
  ContentPageState,
  ContentSnapshot as Snapshot,
} from "@/types/dashboard";

/**
 * Page-level content performance, split into the four buckets an editor works
 * from: what is winning, what is slipping, what is worth writing next, and
 * what has just shipped.
 */

const BUCKETS: readonly { value: ContentBucketId; label: string }[] = [
  { value: "top", label: "Top performing" },
  { value: "declining", label: "Declining" },
  { value: "opportunity", label: "Opportunities" },
  { value: "recent", label: "Recently published" },
];

const STATE_META: Record<
  ContentPageState,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  published: { label: "Published", tone: "positive" },
  decaying: { label: "Decaying", tone: "critical" },
  "needs-refresh": { label: "Needs refresh", tone: "warning" },
  planned: { label: "Planned", tone: "neutral" },
};

export function ContentSnapshot({
  snapshot,
  projectId,
}: {
  snapshot: Snapshot;
  /**
   * Scopes the "Open Content Studio" link to the selected project, so the
   * studio opens filtered to the same set this panel is describing.
   */
  projectId?: string;
}) {
  const [bucket, setBucket] = useState<ContentBucketId>("top");

  const studioHref =
    projectId === undefined || projectId === "portfolio"
      ? "/content"
      : `/content?project=${projectId}`;

  const counts = useMemo(() => {
    const tally = {} as Record<ContentBucketId, number>;
    for (const entry of BUCKETS) tally[entry.value] = 0;
    for (const page of snapshot.pages) tally[page.bucket] += 1;
    return tally;
  }, [snapshot.pages]);

  const pages = snapshot.pages.filter((page) => page.bucket === bucket);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Content Studio"
        title="Content Performance"
        description="Which pages are earning, which are decaying, and what is worth writing next."
        actions={
          <Link href={studioHref} className={buttonClasses("secondary", "sm")}>
            Open Content Studio
            <Icon name="arrow-right" className="h-4 w-4" />
          </Link>
        }
      />

      <PanelBody className="border-b border-border">
        <dl className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <SummaryTile
            icon="alert"
            label="Content decay alerts"
            value={snapshot.decayAlerts}
            detail="pages losing clicks while holding position"
          />
          <SummaryTile
            icon="refresh"
            label="Pages needing refresh"
            value={snapshot.needsRefresh}
            detail="stale facts, dated pricing, or thin coverage"
          />
          <SummaryTile
            icon="sparkles"
            label="Content opportunities"
            value={snapshot.opportunities}
            detail="queries with nothing behind them, or coverage too thin to compete"
          />
          <SummaryTile
            icon="content"
            label="Published this window"
            value={snapshot.publishedInWindow}
            detail="pages that went live inside the selected window"
          />
        </dl>
      </PanelBody>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-4 py-3 sm:px-5">
        <Segmented
          label="Content view"
          value={bucket}
          onChange={setBucket}
          options={BUCKETS.map((entry) => ({
            ...entry,
            count: counts[entry.value],
          }))}
        />
        <p className="text-[11.5px] text-fg-subtle">
          Metrics cover the selected window
        </p>
      </div>

      <Table caption="Content performance by page">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Page</TableHeaderCell>
            <TableHeaderCell align="right">Clicks</TableHeaderCell>
            <TableHeaderCell align="right">Impressions</TableHeaderCell>
            <TableHeaderCell align="right">CTR</TableHeaderCell>
            <TableHeaderCell align="right">Avg position</TableHeaderCell>
            <TableHeaderCell align="right">Conversions</TableHeaderCell>
            <TableHeaderCell align="right">Trend</TableHeaderCell>
            <TableHeaderCell>State</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {pages.length === 0 ? (
            <TableEmptyRow colSpan={8}>
              <EmptyState
                size="sm"
                icon="content"
                title="Nothing in this bucket"
                description="No page for this project falls into this category right now."
              />
            </TableEmptyRow>
          ) : (
            pages.map((page) => (
              <TableRow key={page.id}>
                <TableCell header className="max-w-[320px]">
                  <span className="block truncate">{page.title}</span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] font-normal text-fg-subtle">
                    {page.url}
                  </span>
                  <span className="mt-1 block truncate text-[11.5px] font-normal text-fg-subtle">
                    {page.note}
                  </span>
                </TableCell>
                <TableCell numeric className="font-medium text-fg">
                  {formatCompact(page.clicks)}
                </TableCell>
                <TableCell numeric>{formatCompact(page.impressions)}</TableCell>
                <TableCell numeric>{formatPercent(page.ctr)}</TableCell>
                <TableCell numeric>{page.position}</TableCell>
                <TableCell numeric>{formatNumber(page.conversions)}</TableCell>
                <TableCell align="right">
                  <span className="inline-flex justify-end">
                    <TrendIndicator value={page.trend.value} />
                  </span>
                </TableCell>
                <TableCell>
                  <Badge tone={STATE_META[page.state].tone}>
                    {STATE_META[page.state].label}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <PanelFooter>
        <span>
          {pages.length} {pages.length === 1 ? "page" : "pages"} in this view
        </span>
        <span>
          Every figure here is read from the same content records the Content
          Studio renders.
        </span>
      </PanelFooter>
    </Panel>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  detail,
}: {
  icon: "alert" | "refresh" | "sparkles" | "content";
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3.5 py-3">
      <dt className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
        <Icon name={icon} className="h-3.5 w-3.5" />
        {label}
      </dt>
      <dd className="tabular mt-1.5 text-[20px] leading-none font-semibold text-fg">
        {formatNumber(value)}
      </dd>
      <dd className="mt-1.5 text-[11px] leading-snug text-fg-subtle">{detail}</dd>
    </div>
  );
}
