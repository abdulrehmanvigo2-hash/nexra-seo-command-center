"use client";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import {
  UNMEASURED_DIMENSIONS,
  groupFindings,
  severityCounts,
  type CrawlFinding,
} from "@/lib/crawl/findings";
import { AGENT_NAMES } from "@/lib/mock/seo";
import { CATEGORY_META, SEVERITY_META } from "@/lib/mock/technical/meta";
import { SEVERITY_ORDER } from "@/lib/mock/technical/scoring";
import type { Crawl } from "@/types/crawl";

/**
 * What the crawl's own evidence, put through this product's rules, says.
 *
 * The first findings in Nexra that are measured rather than modelled: every
 * row below came off a page this crawler fetched, and the evidence column is
 * the page's own number. Nothing here is estimated, sampled or filled in.
 *
 * Deliberately not a score. Thirteen of the product's thirty-one rules can be
 * answered from a crawl of this kind, and a number built from thirteen would
 * read as a verdict on the site while describing a fraction of it. The
 * severity, impact and action beside each rule are the ones the product has
 * always stated for that rule — they are not judgements made about this site.
 *
 * The panel ends with what was *not* looked at, and that is the most important
 * thing on it. An issue list with nothing under performance reads as a fast
 * site; this one was never measured for speed at all.
 */

/** Pages listed per rule before the rest are counted rather than named. */
const MAX_PAGES_PER_RULE = 8;

/** The part of a URL worth showing; the full URL is the title attribute. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

export function CrawlFindingsPanel({
  crawl,
  findings,
}: {
  readonly crawl: Crawl | null;
  readonly findings: readonly CrawlFinding[];
}) {
  const groups = groupFindings(findings);
  const counts = severityCounts(groups);
  const pending = crawl !== null && crawl.status !== "completed";

  return (
    <Panel>
      <PanelHeader
        title="Findings from this crawl"
        description="Measured. Every finding below is a rule applied to what this crawl stored, and the evidence is the page's own figure."
      />

      {crawl === null ? (
        <EmptyState
          icon="search"
          title="No crawl yet"
          description="Findings appear once a discovery pass has fetched this site's pages."
        />
      ) : pending ? (
        <EmptyState
          icon="clock"
          title="The pass is still running"
          description="Rules are applied once the crawl finishes. Counted over a half-finished crawl they would describe the half, not the site."
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon="check"
          title="No findings from the rules this crawl can answer"
          description="Nothing matched. That is a statement about the rules listed below, not about the site as a whole — see what was not measured."
        />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-4">
            {SEVERITY_ORDER.filter((severity) => (counts[severity] ?? 0) > 0).map((severity) => (
              <div
                key={severity}
                className="min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2.5"
              >
                <dt className="truncate text-[11.5px] text-fg-subtle">
                  {SEVERITY_META[severity].label}
                </dt>
                <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">
                  {formatNumber(counts[severity] ?? 0)}
                </dd>
                <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">
                  {(counts[severity] ?? 0) === 1 ? "page affected" : "pages affected"}
                </p>
              </div>
            ))}
          </dl>

          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Finding</TableHeaderCell>
                <TableHeaderCell>Severity</TableHeaderCell>
                <TableHeaderCell>Pages and what was observed</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.type}>
                  <TableCell>
                    <span className="block font-medium text-fg">{group.meta.label}</span>
                    <span className="mt-0.5 block text-[11.5px] text-fg-subtle">
                      {CATEGORY_META[group.meta.category].label} · {AGENT_NAMES[group.meta.owner]}
                    </span>
                    <span className="mt-1 block max-w-[20rem] text-[11.5px] leading-snug text-fg-muted">
                      {group.meta.impact}
                    </span>
                    <span className="mt-1 block max-w-[20rem] text-[11.5px] leading-snug text-fg-subtle">
                      Rule&rsquo;s standing advice: {group.meta.action}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge tone={SEVERITY_META[group.meta.severity].tone}>
                      {SEVERITY_META[group.meta.severity].label}
                    </Badge>
                    <span className="mt-1 block text-[11.5px] text-fg-subtle">
                      {formatNumber(group.pages.length)}{" "}
                      {group.pages.length === 1 ? "page" : "pages"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <ul className="space-y-1">
                      {group.pages.slice(0, MAX_PAGES_PER_RULE).map((finding) => (
                        <li key={finding.url} className="min-w-0">
                          <span
                            className="block max-w-[20rem] truncate font-medium text-fg"
                            title={finding.url}
                          >
                            {pathOf(finding.url)}
                          </span>
                          <span className="block max-w-[24rem] text-[11.5px] leading-snug text-fg-muted">
                            {finding.evidence}
                          </span>
                        </li>
                      ))}
                      {group.pages.length > MAX_PAGES_PER_RULE && (
                        <li className="text-[11.5px] text-fg-subtle">
                          and {formatNumber(group.pages.length - MAX_PAGES_PER_RULE)} more
                        </li>
                      )}
                    </ul>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      <div className="border-t border-border px-4 pt-4 pb-1">
        <h3 className="text-[13px] font-semibold text-fg">Not measured by this crawl</h3>
        <p className="mt-1 max-w-3xl text-[12px] leading-snug text-fg-subtle">
          These are absent from the findings above because nothing looked at them — not because
          they are in good order. A crawl reads HTML; it is not a browser, an index, or a link
          graph.
        </p>
        <ul className="mt-2 mb-3 space-y-1.5">
          {UNMEASURED_DIMENSIONS.map((dimension) => (
            <li key={dimension.label} className="text-[12px] leading-snug">
              <span className="font-medium text-fg">{dimension.label}</span>
              <span className="text-fg-subtle"> — {dimension.why}</span>
            </li>
          ))}
        </ul>
      </div>

      <PanelFooter>
        <span>
          Severity, impact and the standing advice come from this product&rsquo;s rule catalogue,
          stated once per rule. The page and the evidence come from the crawl.
        </span>
        <span className="max-w-xl">
          No overall technical score is published from these findings, and none should be until
          the measured model covers enough of the picture to justify one.
        </span>
      </PanelFooter>
    </Panel>
  );
}
