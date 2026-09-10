import { Meter, StackedMeter } from "@/components/ui/meter";
import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompact, formatPercent } from "@/lib/format";
import { HEALTH_META, SCORE_BAND_META, scoreBandOf } from "@/lib/mock/content";
import type {
  ContentHealth,
  ContentMetric,
  ContentRecord,
} from "@/types/content";

/**
 * The numbers above the inventory.
 *
 * Three readings of one selection: the headline figures, the condition of what
 * is live, and what has actually been produced. All three describe whichever
 * pieces are currently filtered in, and the panel says so — a summary that
 * silently described a different set from the table under it would be worse
 * than no summary.
 */
export function ContentSummary({
  metrics,
  health,
  formats,
  total,
  filtered,
}: {
  metrics: readonly ContentMetric[];
  health: readonly {
    readonly id: ContentHealth;
    readonly label: string;
    readonly count: number;
    readonly share: number;
  }[];
  formats: readonly {
    readonly format: ContentRecord["format"];
    readonly label: string;
    readonly count: number;
    readonly volume: number;
    readonly averageScore: number;
  }[];
  /** Size of the whole inventory. */
  total: number;
  /** Size of the current selection. */
  filtered: number;
}) {
  const narrowed = filtered !== total;
  const live = health.reduce((carry, band) => carry + band.count, 0);

  return (
    <div className="space-y-4">
      <MetricTileGrid metrics={metrics} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Condition"
            title="How the live pages are doing"
            description="Every published piece, grouped by what is actually happening to it."
          />
          <PanelBody>
            {live === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-fg-subtle">
                Nothing in this selection is published yet.
              </p>
            ) : (
              <>
                <StackedMeter
                  label="Published pages by condition"
                  segments={health
                    .filter((band) => band.count > 0)
                    .map((band) => ({
                      id: band.id,
                      value: band.count,
                      tone: HEALTH_META[band.id].health === "positive"
                        ? "positive"
                        : HEALTH_META[band.id].health === "neutral"
                          ? "accent"
                          : HEALTH_META[band.id].health === "warning"
                            ? "warning"
                            : "critical",
                    }))}
                />

                <ul className="mt-3.5 grid gap-2 sm:grid-cols-2">
                  {health.map((band) => (
                    <li
                      key={band.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-2"
                      title={HEALTH_META[band.id].description}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            HEALTH_DOT[band.id],
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
              </>
            )}
          </PanelBody>
          <PanelFooter>
            <span>
              {narrowed
                ? `Describing the ${filtered} pieces currently filtered in.`
                : `Describing all ${total} pieces in the inventory.`}
            </span>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Production"
            title="What has been made"
            description="The mix of formats, and how well each one scores where it is published."
          />
          <PanelBody className="space-y-2.5">
            {formats.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-fg-subtle">
                No content in the current selection.
              </p>
            ) : (
              formats.map((row) => (
                <div
                  key={row.format}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="flex items-baseline gap-2 text-[12.5px] font-medium text-fg">
                      {row.label}
                      <span className="tabular text-[11px] font-normal text-fg-subtle">
                        {row.count} {row.count === 1 ? "piece" : "pieces"}
                      </span>
                    </span>
                    <span className="tabular flex items-baseline gap-3 text-[11.5px] text-fg-subtle">
                      <span title="Combined monthly searches across these pieces">
                        {formatCompact(row.volume)} / mo
                      </span>
                      <span
                        className="font-semibold text-fg"
                        title="Mean content score across the published pieces"
                      >
                        {row.averageScore === 0 ? "—" : row.averageScore}
                      </span>
                    </span>
                  </div>
                  <Meter
                    className="mt-2"
                    size="sm"
                    value={row.averageScore}
                    tone={SCORE_BAND_META[scoreBandOf(row.averageScore)].meter}
                    label={`${row.label} averages ${row.averageScore} of 100`}
                  />
                </div>
              ))
            )}
          </PanelBody>
          <PanelFooter>
            <span>
              The bar is the mean Nexra content score for that format — a
              weighted sum over the mock dataset, not a model.
            </span>
          </PanelFooter>
        </Panel>
      </div>
    </div>
  );
}

const HEALTH_DOT: Record<ContentHealth, string> = {
  performing: "bg-positive",
  steady: "bg-accent",
  "needs-refresh": "bg-warning",
  decaying: "bg-critical",
  "not-ranking": "bg-critical",
  unmeasured: "bg-warning",
};
