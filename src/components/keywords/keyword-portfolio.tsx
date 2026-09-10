import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Meter, StackedMeter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import { formatCompact, formatPercent } from "@/lib/format";
import { INTENT_META, RANKING_STATUS_META } from "@/lib/mock/keywords";
import type {
  IntentBreakdownRow,
  KeywordMetric,
  RankingBandCount,
} from "@/types/keyword";

/**
 * The numbers above the keyword table.
 *
 * Three readings of one selection: the headline figures, where the set sits in
 * the results, and what the searchers behind it want. All three describe
 * whichever keywords are currently filtered in, and the panel says so — a
 * summary that silently described a different set from the table under it
 * would be worse than no summary.
 */
export function KeywordPortfolio({
  metrics,
  bands,
  intents,
  total,
  filtered,
}: {
  metrics: readonly KeywordMetric[];
  bands: readonly RankingBandCount[];
  intents: readonly IntentBreakdownRow[];
  /** Size of the whole dataset. */
  total: number;
  /** Size of the current selection. */
  filtered: number;
}) {
  const narrowed = filtered !== total;

  return (
    <div className="space-y-4">
      <MetricTileGrid metrics={metrics} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Distribution"
            title="Where the set ranks"
            description="Every analysed keyword, grouped by the position band it currently holds."
          />
          <PanelBody>
            <StackedMeter
              label="Keywords by ranking position band"
              segments={bands.map((band) => ({
                id: band.id,
                value: band.count,
                tone: RANKING_STATUS_META[band.id].meter,
              }))}
            />

            <ul className="mt-3.5 grid gap-2 sm:grid-cols-2">
              {bands.map((band) => (
                <li
                  key={band.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-2"
                  title={RANKING_STATUS_META[band.id].description}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        BAND_DOT[band.id],
                      )}
                    />
                    <span className="truncate text-[12px] text-fg-muted">
                      {band.label}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="tabular text-[13px] font-semibold text-fg">
                      {band.count}
                    </span>
                    <span className="tabular text-[11px] text-fg-subtle">
                      {formatPercent(band.share, 0)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </PanelBody>
          <PanelFooter>
            <span>
              {narrowed
                ? `Describing the ${filtered} keywords currently filtered in.`
                : `Describing all ${total} analysed keywords.`}
            </span>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Search intent"
            title="What the searchers want"
            description="Volume and average position by intent, so a strong-looking set is not just informational reach."
          />
          <PanelBody className="space-y-2.5">
            {intents.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-fg-subtle">
                No keywords in the current selection.
              </p>
            ) : (
              intents.map((row) => (
                <div
                  key={row.intent}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="flex items-baseline gap-2 text-[12.5px] font-medium text-fg">
                      {INTENT_META[row.intent].label}
                      <span className="tabular text-[11px] font-normal text-fg-subtle">
                        {row.count} keywords
                      </span>
                    </span>
                    <span className="tabular flex items-baseline gap-3 text-[11.5px] text-fg-subtle">
                      <span title="Total monthly searches">
                        {formatCompact(row.volume)} / mo
                      </span>
                      <span title="Average position across the keywords that rank">
                        {row.averagePosition === null
                          ? "not ranking"
                          : `avg. ${row.averagePosition}`}
                      </span>
                      <span
                        className="font-semibold text-fg"
                        title="Mean opportunity score"
                      >
                        {row.opportunityScore}
                      </span>
                    </span>
                  </div>
                  <Meter
                    className="mt-2"
                    size="sm"
                    value={row.share}
                    tone={
                      row.intent === "transactional"
                        ? "positive"
                        : row.intent === "commercial" || row.intent === "mixed"
                          ? "accent"
                          : row.intent === "local"
                            ? "warning"
                            : "neutral"
                    }
                    label={`${INTENT_META[row.intent].label} is ${row.share}% of the selection`}
                  />
                </div>
              ))
            )}
          </PanelBody>
          <PanelFooter>
            <span>
              The bar is each intent&apos;s share of the selection; the score is
              its mean Nexra opportunity score.
            </span>
          </PanelFooter>
        </Panel>
      </div>
    </div>
  );
}

const BAND_DOT: Record<string, string> = {
  "top-3": "bg-positive",
  "top-10": "bg-accent",
  "top-20": "bg-fg-subtle",
  "top-100": "bg-warning",
  "not-ranking": "bg-critical",
};
