"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
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
import { cn } from "@/lib/cn";
import { DEPTH_LIMIT, MIN_INTERNAL_LINKS_IN } from "@/lib/mock/technical";
import {
  DepthValue,
  LinksInValue,
  ScoreBreakdownList,
  ScoreReading,
  ScoreValue,
  SeverityBadge,
  toneForScore,
} from "@/components/technical/technical-chrome";
import type { TechnicalFilters as Filters } from "@/components/technical/filters";
import type { LinkSummary } from "@/types/technical";

/**
 * Internal linking, read as findings.
 *
 * The link graph is Content Studio's own — there is no second graph in this
 * product. What this view adds is what sits at the other end of each edge: a
 * link to a URL that does not serve, one that lands on a redirect, one that
 * lands on a page kept out of the index. Same links, read technically.
 *
 * Only pages with something wrong are listed. A well-supported page does not
 * need a row, and a table that gave it one would bury the findings.
 */

type Tile = {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly icon: IconName;
  readonly note: string;
  readonly tone: "positive" | "warning" | "critical" | "neutral";
  readonly filter?: Partial<Filters>;
};

const TONE_TEXT = {
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
  neutral: "text-fg",
} as const;

export function LinksView({
  links,
  onFilter,
}: {
  links: LinkSummary;
  onFilter: (patch: Partial<Filters>) => void;
}) {
  if (links.total === 0) {
    return (
      <Panel>
        <EmptyState
          icon="link-off"
          title="No pages in this selection"
          description="Clear a filter to bring pages back into scope."
        />
      </Panel>
    );
  }

  const tiles: readonly Tile[] = [
    {
      id: "orphans",
      label: "Orphan pages",
      count: links.orphans,
      icon: "link-off",
      note: "Nothing on the site links to them.",
      tone: "critical",
    },
    {
      id: "weak",
      label: "Weakly linked",
      count: links.weak,
      icon: "link-off",
      note: `Under ${MIN_INTERNAL_LINKS_IN} inbound links.`,
      tone: "warning",
    },
    {
      id: "deep",
      label: "Buried pages",
      count: links.deep,
      icon: "layers",
      note: `More than ${DEPTH_LIMIT} clicks from the home page.`,
      tone: "warning",
    },
    {
      id: "broken",
      label: "Linking to broken URLs",
      count: links.brokenLinks,
      icon: "alert",
      note: "Dead ends for visitors and wasted crawl requests.",
      tone: "critical",
      filter: { category: "links" },
    },
    {
      id: "redirects",
      label: "Linking through redirects",
      count: links.redirectLinks,
      icon: "arrow-right",
      note: "Each hop loses a little signal on the way.",
      tone: "neutral",
    },
    {
      id: "non-canonical",
      label: "Linking to excluded pages",
      count: links.nonCanonicalLinks,
      icon: "split",
      note: "Authority sent to URLs that will not be indexed.",
      tone: "warning",
    },
    {
      id: "dead-ends",
      label: "Dead ends",
      count: links.deadEnds,
      icon: "link-off",
      note: "Link to nothing else on the site.",
      tone: "neutral",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-1">
          <PanelHeader
            eyebrow="Internal links"
            title="How well the site supports itself"
            description={`Averaging ${links.averageLinksIn} inbound links a page.`}
          />
          <PanelBody className="space-y-4">
            <ScoreReading
              score={links.score.score}
              caption="Internal linking score"
              label={`Internal linking: ${links.score.score} out of 100`}
              detail={links.score.summary}
            />
            <ScoreBreakdownList score={links.score} />
          </PanelBody>
          <PanelFooter>
            <span>{links.rows.length} pages with findings</span>
            <span>{links.total} in scope</span>
          </PanelFooter>
        </Panel>

        <Panel className="xl:col-span-2">
          <PanelHeader
            eyebrow="Findings"
            title="What is wrong with the graph"
            description="Counted per page, not per link: a page linking to three broken URLs is one page to fix."
          />
          <PanelBody>
            <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              {tiles.map((tile) => {
                const body = (
                  <>
                    <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
                      <Icon name={tile.icon} className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{tile.label}</span>
                    </span>
                    <span className="mt-2 flex items-baseline gap-1.5">
                      <span
                        className={cn(
                          "tabular text-[20px] leading-none font-semibold",
                          TONE_TEXT[tile.tone],
                        )}
                      >
                        {tile.count}
                      </span>
                      <span className="text-[11px] text-fg-subtle">
                        of {links.total}
                      </span>
                    </span>
                    <span className="mt-1.5 block text-[11px] leading-snug text-fg-subtle">
                      {tile.note}
                    </span>
                  </>
                );

                return (
                  <li key={tile.id}>
                    {tile.filter ? (
                      <button
                        type="button"
                        onClick={() => onFilter(tile.filter as Partial<Filters>)}
                        className="flex h-full w-full flex-col rounded-md border border-border bg-surface-raised px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-surface-hover"
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="flex h-full flex-col rounded-md border border-border bg-surface-raised px-3 py-2.5">
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          eyebrow="Page by page"
          title="Pages with linking findings"
          description="Worst first. A page appears here only when something about its linking is wrong."
        />
        {links.rows.length === 0 ? (
          <EmptyState
            size="sm"
            icon="check"
            title="Nothing wrong with the graph"
            description="Every page in this selection is linked, reachable, and points somewhere that resolves."
          />
        ) : (
          <Table caption="Pages with internal linking findings">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Page</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell">
                  Finding
                </TableHeaderCell>
                <TableHeaderCell align="right">In</TableHeaderCell>
                <TableHeaderCell align="right">Out</TableHeaderCell>
                <TableHeaderCell align="right" className="hidden sm:table-cell">
                  Depth
                </TableHeaderCell>
                <TableHeaderCell align="right" className="hidden xl:table-cell">
                  Broken out
                </TableHeaderCell>
                <TableHeaderCell align="right" className="hidden xl:table-cell">
                  Redirects out
                </TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell">
                  Severity
                </TableHeaderCell>
                <TableHeaderCell align="right">Support</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {links.rows.map((row) => (
                <TableRow key={row.pageId}>
                  <TableCell header className="max-w-[20rem] min-w-[12rem]">
                    <span className="block min-w-0">
                      <Link
                        href={`/technical/pages/${row.pageId}`}
                        className="block truncate font-medium text-fg transition-colors hover:text-accent"
                        title={row.title}
                      >
                        {row.title}
                      </Link>
                      <span
                        className="block truncate font-mono text-[11px] text-fg-subtle"
                        title={row.path}
                      >
                        {row.path}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-[20rem] lg:table-cell">
                    <span className="block truncate" title={row.finding}>
                      {row.finding}
                    </span>
                  </TableCell>
                  <TableCell numeric>
                    <LinksInValue
                      links={row.linksIn}
                      floor={MIN_INTERNAL_LINKS_IN}
                    />
                  </TableCell>
                  <TableCell numeric>
                    <span
                      className={cn(
                        "tabular",
                        row.linksOut === 0 ? "text-warning" : "text-fg-muted",
                      )}
                    >
                      {row.linksOut}
                    </span>
                  </TableCell>
                  <TableCell numeric className="hidden sm:table-cell">
                    <DepthValue depth={row.crawlDepth} limit={DEPTH_LIMIT} />
                  </TableCell>
                  <TableCell numeric className="hidden xl:table-cell">
                    <span
                      className={cn(
                        "tabular",
                        row.brokenOut > 0 ? "text-critical" : "text-fg-subtle",
                      )}
                    >
                      {row.brokenOut}
                    </span>
                  </TableCell>
                  <TableCell numeric className="hidden xl:table-cell">
                    <span className="tabular text-fg-subtle">
                      {row.redirectOut}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <SeverityBadge severity={row.severity} />
                  </TableCell>
                  <TableCell numeric>
                    <ScoreValue
                      score={row.support}
                      label="Support score"
                      tone={toneForScore(row.support)}
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
