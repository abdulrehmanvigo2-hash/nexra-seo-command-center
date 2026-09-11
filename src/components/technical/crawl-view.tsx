"use client";

import { Icon, type IconName } from "@/components/icons";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { DEPTH_LIMIT, MODELLED_SOURCE_NOTE } from "@/lib/mock/technical";
import {
  DistributionList,
  ScoreBreakdownList,
  ScoreReading,
} from "@/components/technical/technical-chrome";
import type { CrawlSummary } from "@/types/technical";
import type { TechnicalFilters as Filters } from "@/components/technical/filters";

/**
 * What a crawler can and cannot reach.
 *
 * The reading is split down the middle: pages held back on purpose and pages
 * that are actually broken. Both are absent from search, and treating them as
 * one number is how a site with a deliberate noindex on its staging section
 * gets reported as having a crawl problem it does not have.
 *
 * Each figure is a control: selecting one narrows the whole workspace to those
 * pages, so the Pages tab shows exactly what the number counted.
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

export function CrawlView({
  crawl,
  onFilter,
}: {
  crawl: CrawlSummary;
  onFilter: (patch: Partial<Filters>) => void;
}) {
  const intentional: readonly Tile[] = [
    {
      id: "noindex",
      label: "Noindex",
      count: crawl.noindex,
      icon: "shield",
      note: "Asking not to be indexed. A decision, not a defect.",
      tone: "neutral",
      filter: { indexability: "noindex" },
    },
    {
      id: "blocked",
      label: "Blocked in robots.txt",
      count: crawl.blocked,
      icon: "shield",
      note: "Never requested. Worth confirming each one is deliberate.",
      tone: "warning",
      filter: { crawlState: "blocked" },
    },
    {
      id: "redirects",
      label: "Redirects",
      count: crawl.redirects,
      icon: "arrow-right",
      note: "Answer with a redirect rather than content.",
      tone: "neutral",
      filter: { crawlState: "redirected" },
    },
  ];

  const problems: readonly Tile[] = [
    {
      id: "broken",
      label: "Broken pages",
      count: crawl.broken,
      icon: "alert",
      note: "Nothing is served. Every one of these is lost traffic.",
      tone: "critical",
      filter: { crawlState: "broken" },
    },
    {
      id: "orphans",
      label: "Orphan pages",
      count: crawl.orphans,
      icon: "link-off",
      note: "No internal link points at them.",
      tone: "warning",
    },
    {
      id: "deep",
      label: `Beyond ${DEPTH_LIMIT} clicks`,
      count: crawl.deepPages,
      icon: "layers",
      note: "Buried far enough in to be crawled rarely.",
      tone: "warning",
    },
    {
      id: "canonical",
      label: "Canonical conflicts",
      count: crawl.canonicalConflicts,
      icon: "split",
      note: "The canonical contradicts another signal on the same URL.",
      tone: "critical",
      filter: { canonical: "conflict" },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-1">
          <PanelHeader
            eyebrow="Crawlability"
            title="Can the site be crawled"
            description={`${crawl.crawlable} of ${crawl.total} URLs return content a crawler can read.`}
          />
          <PanelBody className="space-y-4">
            <ScoreReading
              score={crawl.score.score}
              caption="Crawlability score"
              label={`Crawlability: ${crawl.score.score} out of 100`}
              detail={crawl.score.summary}
            />
            <ScoreBreakdownList score={crawl.score} />
          </PanelBody>
          <PanelFooter>
            <span>Averaging {crawl.averageDepth} clicks deep</span>
            <span>{crawl.inSitemap} submitted</span>
          </PanelFooter>
        </Panel>

        <div className="space-y-4 xl:col-span-2">
          <Panel>
            <PanelHeader
              eyebrow="Held back on purpose"
              title="Intentional exclusions"
              description={`${crawl.intentional} URLs are kept out of search by a directive we set. These are decisions to review, not defects to fix.`}
            />
            <PanelBody>
              <TileRow tiles={intentional} total={crawl.total} onFilter={onFilter} />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Actually wrong"
              title="Crawl problems"
              description={`${crawl.problems} URLs are unreachable, unlinked, or contradicting themselves.`}
            />
            <PanelBody>
              <TileRow tiles={problems} total={crawl.total} onFilter={onFilter} />
            </PanelBody>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Structure"
            title="Crawl depth"
            description="Clicks from the home page. Depth is read as importance, so the further in a page sits, the less often it is fetched."
          />
          <PanelBody>
            <DistributionList rows={crawl.depth} />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Discovery"
            title="Sitemap"
            description="What we submit against what we publish."
          />
          <PanelBody className="space-y-3">
            <dl className="grid grid-cols-2 gap-3">
              <Stat
                label="In the sitemap"
                value={crawl.inSitemap}
                detail={`${formatPercent(
                  crawl.total === 0 ? 0 : (crawl.inSitemap / crawl.total) * 100,
                  0,
                )} of published URLs`}
              />
              <Stat
                label="Indexable and missing"
                value={crawl.missingFromSitemap}
                detail="Discovery relies on internal links alone."
                tone={crawl.missingFromSitemap > 0 ? "warning" : "positive"}
              />
            </dl>
          </PanelBody>
          <PanelFooter>
            <span>{MODELLED_SOURCE_NOTE}</span>
          </PanelFooter>
        </Panel>
      </div>
    </div>
  );
}

const TONE_TEXT = {
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
  neutral: "text-fg",
} as const;

function TileRow({
  tiles,
  total,
  onFilter,
}: {
  tiles: readonly Tile[];
  total: number;
  onFilter: (patch: Partial<Filters>) => void;
}) {
  return (
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
                of {total}
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
  );
}

function Stat({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: number;
  detail: string;
  tone?: keyof typeof TONE_TEXT;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <dt className="text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "tabular mt-1.5 text-[20px] leading-none font-semibold",
          TONE_TEXT[tone],
        )}
      >
        {value}
      </dd>
      <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">{detail}</p>
    </div>
  );
}
