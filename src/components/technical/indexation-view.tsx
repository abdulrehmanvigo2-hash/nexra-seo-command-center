"use client";

import { Icon, type IconName } from "@/components/icons";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { MODELLED_SOURCE_NOTE } from "@/lib/mock/technical";
import {
  DistributionList,
  ScoreBreakdownList,
  ScoreReading,
} from "@/components/technical/technical-chrome";
import type { TechnicalFilters as Filters } from "@/components/technical/filters";
import type { IndexationSummary } from "@/types/technical";

/**
 * What is in the index, and what is allowed to be.
 *
 * The module keeps the two questions apart everywhere, and this view is where
 * that distinction is the whole point. Indexability is permission — what the
 * page's own directives and canonical allow. Index status is presence — what a
 * search engine actually did. A page can be perfectly indexable and absent,
 * which is the finding worth acting on; it can also be present while asking
 * not to be, which is a contradiction worth settling.
 *
 * Every tile narrows the workspace, so the Pages tab shows exactly the URLs
 * behind whichever number was selected.
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

export function IndexationView({
  indexation,
  onFilter,
}: {
  indexation: IndexationSummary;
  onFilter: (patch: Partial<Filters>) => void;
}) {
  const presence: readonly Tile[] = [
    {
      id: "indexed",
      label: "Indexed",
      count: indexation.indexed,
      icon: "check",
      note: "Modelled as present in the index.",
      tone: "positive",
      filter: { indexStatus: "indexed" },
    },
    {
      id: "not-indexed",
      label: "Not indexed",
      count: indexation.notIndexed,
      icon: "alert",
      note: "Eligible and absent. This is the number to work on.",
      tone: "critical",
      filter: { indexStatus: "not-indexed" },
    },
    {
      id: "excluded",
      label: "Excluded",
      count: indexation.excluded,
      icon: "shield",
      note: "Kept out by a directive or a canonical we set.",
      tone: "neutral",
      filter: { indexStatus: "excluded" },
    },
    {
      id: "pending",
      label: "Pending",
      count: indexation.pending,
      icon: "clock",
      note: "Discovered, not yet processed.",
      tone: "warning",
      filter: { indexStatus: "pending" },
    },
  ];

  const permission: readonly Tile[] = [
    {
      id: "indexable",
      label: "Indexable",
      count: indexation.indexable,
      icon: "check",
      note: "Open to indexing and canonical to itself.",
      tone: "positive",
      filter: { indexability: "indexable" },
    },
    {
      id: "noindex",
      label: "Noindex",
      count: indexation.noindex,
      icon: "shield",
      note: "The page asks not to be indexed.",
      tone: "neutral",
      filter: { indexability: "noindex" },
    },
    {
      id: "canonicalised",
      label: "Canonicalised",
      count: indexation.canonicalised,
      icon: "split",
      note: "Defers to the URL its canonical names.",
      tone: "neutral",
      filter: { indexability: "canonicalised" },
    },
    {
      id: "redirect",
      label: "Redirects",
      count: indexation.redirects,
      icon: "arrow-right",
      note: "Sends the crawler somewhere else.",
      tone: "neutral",
      filter: { indexability: "redirect" },
    },
    {
      id: "blocked",
      label: "Blocked",
      count: indexation.blocked,
      icon: "shield",
      note: "robots.txt stops the request, so the directive is never read.",
      tone: "warning",
      filter: { indexability: "blocked" },
    },
    {
      id: "error",
      label: "Error",
      count: indexation.errors,
      icon: "alert",
      note: "The response itself rules the URL out.",
      tone: "critical",
      filter: { indexability: "error" },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-1">
          <PanelHeader
            eyebrow="Indexation"
            title="Coverage"
            description={`${indexation.indexed} of ${indexation.indexable} indexable URLs are in the index.`}
          />
          <PanelBody className="space-y-4">
            <ScoreReading
              score={indexation.score.score}
              caption="Indexation score"
              label={`Indexation: ${indexation.score.score} out of 100`}
              detail={indexation.score.summary}
            />
            <ScoreBreakdownList score={indexation.score} />
          </PanelBody>
          <PanelFooter>
            <span>{formatPercent(indexation.coverage, 0)} coverage</span>
            <span>{indexation.total} published URLs</span>
          </PanelFooter>
        </Panel>

        <div className="space-y-4 xl:col-span-2">
          <Panel>
            <PanelHeader
              eyebrow="Index status"
              title="What is in the index"
              description="Presence, as this dataset models it. Not the same reading as whether the page is allowed in."
            />
            <PanelBody>
              <TileRow
                tiles={presence}
                total={indexation.total}
                onFilter={onFilter}
              />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Indexability"
              title="What is allowed in"
              description="Permission, read off the page's own directives, canonical, and response. A page can be indexable and still absent."
            />
            <PanelBody>
              <TileRow
                tiles={permission}
                total={indexation.total}
                onFilter={onFilter}
              />
            </PanelBody>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Contradictions"
            title="Where the signals disagree"
            description="Two states that should not exist. Each one is a decision somebody has to settle."
          />
          <PanelBody>
            <dl className="grid grid-cols-2 gap-3">
              <Stat
                label="Submitted, not indexed"
                value={indexation.sitemapMismatches}
                detail="In the sitemap, eligible, and still absent — usually a quality or duplication problem rather than a discovery one."
                tone={indexation.sitemapMismatches > 0 ? "critical" : "positive"}
              />
              <Stat
                label="Indexed but noindex"
                value={indexation.conflicts}
                detail="Present in the index while the page asks to be left out."
                tone={indexation.conflicts > 0 ? "critical" : "positive"}
              />
            </dl>
          </PanelBody>
          <PanelFooter>
            <span>{MODELLED_SOURCE_NOTE}</span>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Exclusions"
            title="Why pages are out"
            description="Every URL that cannot be indexed, grouped by what is stopping it."
          />
          <PanelBody>
            <DistributionList
              rows={indexation.reasons}
              emptyLabel="Every page in this selection is open to indexing."
            />
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

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
    <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {tiles.map((tile) => (
        <li key={tile.id}>
          <button
            type="button"
            onClick={() => tile.filter && onFilter(tile.filter)}
            disabled={!tile.filter}
            className="flex h-full w-full flex-col rounded-md border border-border bg-surface-raised px-3 py-2.5 text-left transition-colors enabled:hover:border-accent/40 enabled:hover:bg-surface-hover"
          >
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
              <span className="text-[11px] text-fg-subtle">of {total}</span>
            </span>
            <span className="mt-1.5 block text-[11px] leading-snug text-fg-subtle">
              {tile.note}
            </span>
          </button>
        </li>
      ))}
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
