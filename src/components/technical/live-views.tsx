"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { SEVERITY_LABEL } from "@/lib/crawl/findings/present";
import { OF_FETCHED_NOTE, type CountRow, type FindingSummaryRow, type LiveTechnicalView, type PageRow } from "@/lib/crawl/overview/present";

/**
 * The live Technical SEO tabs (Phase 3, checkpoint 3.2): presentational
 * panels over one recorded crawl, built by `@/lib/crawl/overview/present`.
 * Every panel carries the crawl's coverage banner and says its counts are of
 * the fetched pages; a reading the crawler did not establish shows as
 * unknown, never as a pass.
 */

const UNKNOWN = "—";
const yesNo = (value: boolean | null) => (value === null ? UNKNOWN : value ? "Yes" : "No");

/** The coverage sentence every section carries. */
export function CoverageBanner({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-fg-muted" role="note">
      {text}
    </p>
  );
}

function LivePanel({ title, description, banner, children, footer }: { title: string; description?: string; banner: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Panel>
      <PanelHeader title={title} description={description} actions={<Badge tone="accent" title="Read from this product's own crawl records. Not fixture data.">Observed</Badge>} />
      <PanelBody className="space-y-3">
        <CoverageBanner text={banner} />
        {children}
      </PanelBody>
      <PanelFooter>
        <span>{footer ?? OF_FETCHED_NOTE}</span>
      </PanelFooter>
    </Panel>
  );
}

function CountList({ rows, empty }: { rows: readonly CountRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-fg-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center justify-between gap-3 py-1.5 text-sm">
          <span className="text-fg-muted">{row.tone ? <Badge tone={row.count > 0 ? row.tone : "neutral"}>{row.label}</Badge> : row.label}</span>
          <span className="tabular font-medium text-fg">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}

function FindingList({ rows, empty }: { rows: readonly FindingSummaryRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-fg-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.key} className="rounded-md border border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={row.tone}>{row.severityLabel}</Badge>
            <span className="text-sm font-medium text-fg">{row.ruleLabel}</span>
            <span className="text-xs text-fg-subtle">{row.categoryLabel}</span>
          </div>
          <p className="mt-1 text-[13px] text-fg">{row.message}</p>
          <p className="mt-1 truncate font-mono text-[11.5px] text-fg-muted" title={row.paths.join(" ")}>
            {row.paths.join(" · ")}
            {row.morePages > 0 ? ` +${row.morePages} more` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

function SeverityCell({ row }: { row: PageRow }) {
  if (!row.fetched) return <span className="text-fg-subtle">not read</span>;
  if (row.highestSeverity === null) return <span className="text-fg-subtle">none</span>;
  const meta = SEVERITY_LABEL[row.highestSeverity];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function PageLink({ row }: { row: PageRow }) {
  return (
    <Link href={row.href} className="block max-w-[22rem] truncate font-mono text-[12px] text-fg hover:underline" title={row.url}>
      {row.path}
    </Link>
  );
}

const fetchLabel = (row: PageRow) => (row.fetchState === "budget-skipped" ? "not reached" : row.fetchState);

// ---------------------------------------------------------------------------

export function LiveOverview({ view }: { view: LiveTechnicalView }) {
  const o = view.overview;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <LivePanel title="Findings by severity" description="Findings the fixed rules recorded when this crawl finished." banner={view.banner}>
        <CountList rows={o.findingsBySeverity} empty="No findings." />
      </LivePanel>
      <LivePanel title="Pages by severity" description="Each fetched page at the highest severity among the findings that name it." banner={view.banner}>
        <CountList rows={o.pagesBySeverity} empty="No fetched pages." />
      </LivePanel>
      <LivePanel title="Findings by category" banner={view.banner}>
        <CountList rows={o.findingsByCategory} empty="No findings in this selection." />
      </LivePanel>
      <LivePanel
        title="Crawl and index at a glance"
        description="Declared signals: what each fetched page answered and declared. Not whether Google indexed it."
        banner={view.banner}
        footer={`${OF_FETCHED_NOTE} Declared signals only; nothing here reports indexation.`}
      >
        <CountList rows={o.statusMix} empty="No fetched pages." />
        <CountList rows={o.atAGlance} empty="No fetched pages." />
      </LivePanel>
      <LivePanel title="Top priority findings" description="The most severe recorded findings, at most five." banner={view.banner}>
        <FindingList rows={o.topFindings} empty="No findings in this selection." />
      </LivePanel>
      <LivePanel title="Most affected pages" description="Pages named by the most findings, at most five." banner={view.banner}>
        {o.mostAffected.length === 0 ? (
          <p className="text-sm text-fg-muted">No finding names a page in this selection.</p>
        ) : (
          <ul className="divide-y divide-border">
            {o.mostAffected.map((entry) => (
              <li key={entry.url} className="flex items-center justify-between gap-3 py-1.5">
                <span className="truncate font-mono text-[12px] text-fg" title={entry.url}>
                  {entry.path}
                </span>
                <span className="tabular text-sm font-medium text-fg">{entry.findings}</span>
              </li>
            ))}
          </ul>
        )}
      </LivePanel>
    </div>
  );
}

export function LiveCrawlability({ view }: { view: LiveTechnicalView }) {
  const c = view.crawlability;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <LivePanel title="Fetch outcomes" description={`robots.txt: ${c.robotsState} · sitemap: ${c.sitemapState}.`} banner={view.banner} footer="Every recorded URL, fetched or not. A URL not reached was never looked at.">
          <CountList rows={c.fetchStates} empty="No pages recorded." />
        </LivePanel>
        <LivePanel title="Crawl depth" description="Clicks from the start URL at which each fetched page was reached." banner={view.banner}>
          <CountList rows={c.depth} empty="No fetched pages." />
        </LivePanel>
      </div>
      <LivePanel title="Crawlability per URL" banner={view.banner} footer="Server response is the crawler's own measurement of one fetch, not a Core Web Vitals reading.">
        <div className="overflow-x-auto">
          <Table caption="Crawlability per recorded URL">
            <TableHead>
              <TableRow>
                <TableHeaderCell>URL</TableHeaderCell>
                <TableHeaderCell>Fetch</TableHeaderCell>
                <TableHeaderCell align="right">HTTP</TableHeaderCell>
                <TableHeaderCell>robots.txt allows</TableHeaderCell>
                <TableHeaderCell align="right">Redirect hops</TableHeaderCell>
                <TableHeaderCell align="right">Depth</TableHeaderCell>
                <TableHeaderCell>In sitemap</TableHeaderCell>
                <TableHeaderCell align="right">Server response (crawler-measured)</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {c.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><PageLink row={row} /></TableCell>
                  <TableCell>{fetchLabel(row)}</TableCell>
                  <TableCell numeric>{row.httpStatus ?? UNKNOWN}</TableCell>
                  <TableCell>{yesNo(row.robotsTxtAllowed)}</TableCell>
                  <TableCell numeric>{row.fetched ? row.redirectHops : UNKNOWN}</TableCell>
                  <TableCell numeric>{row.depth ?? UNKNOWN}</TableCell>
                  <TableCell>{yesNo(row.inSitemap)}</TableCell>
                  <TableCell numeric>{row.responseMs === null ? UNKNOWN : `${row.responseMs} ms`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </LivePanel>
    </div>
  );
}

export function LiveSchema({ view }: { view: LiveTechnicalView }) {
  const s = view.schema;
  return (
    <div className="space-y-4">
      <LivePanel
        title="Detected structured data types"
        description={`${s.pagesWithTypes} of ${s.fetched} fetched pages declare at least one type; ${s.parseFailures} had a block that could not be parsed.`}
        banner={view.banner}
        footer="Detected types only: the types each page's JSON-LD declared. Nothing here validates the markup or says whether it is eligible for any search feature."
      >
        <CountList rows={s.types} empty="No fetched page declared a structured data type." />
      </LivePanel>
      <LivePanel title="Detected types per page" banner={view.banner} footer="Detected types only; no validity is claimed.">
        <div className="overflow-x-auto">
          <Table caption="Detected structured data per fetched page">
            <TableHead>
              <TableRow>
                <TableHeaderCell>URL</TableHeaderCell>
                <TableHeaderCell>Detected types</TableHeaderCell>
                <TableHeaderCell align="right">Blocks</TableHeaderCell>
                <TableHeaderCell>Parse failed</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {s.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><PageLink row={row} /></TableCell>
                  <TableCell>{row.schemaTypes.length === 0 ? <span className="text-fg-subtle">none detected</span> : row.schemaTypes.join(", ")}</TableCell>
                  <TableCell numeric>{row.schemaBlocks}</TableCell>
                  <TableCell>{row.schemaParseFailed ? "Yes" : "No"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </LivePanel>
    </div>
  );
}

export function LiveLinks({ view }: { view: LiveTechnicalView }) {
  const l = view.links;
  const summary: CountRow[] = [
    { key: "internal", label: "Internal edges", count: l.summary.internal },
    { key: "external", label: "External edges", count: l.summary.external },
    { key: "nofollow", label: "Marked nofollow", count: l.summary.nofollow },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <LivePanel
          title="Recorded link edges"
          description={`${l.summary.read} edges read${l.summary.cut ? ", cut at the read limit" : ""}. Links found on the fetched pages; no target was fetched to check it.`}
          banner={view.banner}
          footer="Edges found on the pages this crawl fetched. No inbound backlink record exists in this product."
        >
          <CountList rows={summary} empty="No edges recorded." />
          {l.summary.externalHosts.length > 0 && (
            <p className="text-xs text-fg-subtle">
              External hosts: {l.summary.externalHosts.map((h) => `${h.host} (${h.edges})`).join(", ")}
              {l.summary.moreExternalHosts > 0 ? `, and ${l.summary.moreExternalHosts} more` : ""}
            </p>
          )}
        </LivePanel>
        <LivePanel
          title="No inbound link from the fetched pages"
          description="Fetched pages, below the start URL, that no other fetched page links to. Within this crawl only: a page may be linked from pages this crawl did not reach."
          banner={view.banner}
          footer="Within this crawl: no inbound link from the fetched pages. This does not prove a page is orphaned."
        >
          {l.noInbound.length === 0 ? (
            <p className="text-sm text-fg-muted">Every fetched page below the start URL has an inbound link from another fetched page.</p>
          ) : (
            <ul className="space-y-1">
              {l.noInbound.map((entry) => (
                <li key={entry.url} className="truncate font-mono text-[12px] text-fg" title={entry.url}>
                  {entry.path} <span className="text-fg-subtle">· depth {entry.depth ?? UNKNOWN} · in sitemap {yesNo(entry.inSitemap)}</span>
                </li>
              ))}
            </ul>
          )}
        </LivePanel>
      </div>
      <LivePanel title="Broken internal links" description="Recorded findings for internal links to pages that answered with an error." banner={view.banner}>
        <FindingList rows={l.broken} empty="No internal link to an error page was recorded in this selection." />
      </LivePanel>
      <LivePanel title="Links per fetched page" banner={view.banner} footer="Internal links counted between the pages this crawl fetched.">
        <div className="overflow-x-auto">
          <Table caption="Internal links per fetched page">
            <TableHead>
              <TableRow>
                <TableHeaderCell>URL</TableHeaderCell>
                <TableHeaderCell align="right">Links in (from fetched pages)</TableHeaderCell>
                <TableHeaderCell align="right">Internal links out</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {l.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><PageLink row={row} /></TableCell>
                  <TableCell numeric>{row.linksIn}</TableCell>
                  <TableCell numeric>{row.linksOut}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </LivePanel>
    </div>
  );
}

export function LivePages({ view }: { view: LiveTechnicalView }) {
  return (
    <LivePanel title="Recorded pages" description="Every URL this crawl recorded, fetched or not. Open a page for its recorded detail." banner={view.banner} footer="A page not reached was discovered and never looked at.">
      {view.pages.length === 0 ? (
        <EmptyState size="sm" icon="search" title="No page matches these filters" description="Clear a filter to widen the set." />
      ) : (
        <div className="overflow-x-auto">
          <Table caption="Pages recorded by this crawl">
            <TableHead>
              <TableRow>
                <TableHeaderCell>URL</TableHeaderCell>
                <TableHeaderCell>Fetch</TableHeaderCell>
                <TableHeaderCell align="right">HTTP</TableHeaderCell>
                <TableHeaderCell>Title</TableHeaderCell>
                <TableHeaderCell>Highest severity</TableHeaderCell>
                <TableHeaderCell align="right">Findings</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {view.pages.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><PageLink row={row} /></TableCell>
                  <TableCell>{fetchLabel(row)}</TableCell>
                  <TableCell numeric>{row.httpStatus ?? UNKNOWN}</TableCell>
                  <TableCell><span className="block max-w-[18rem] truncate" title={row.title ?? undefined}>{row.title ?? UNKNOWN}</span></TableCell>
                  <TableCell><SeverityCell row={row} /></TableCell>
                  <TableCell numeric>{row.fetched ? row.findings : UNKNOWN}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </LivePanel>
  );
}
