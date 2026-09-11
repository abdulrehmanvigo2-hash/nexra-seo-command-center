import { Icon } from "@/components/icons";
import { StackedMeter } from "@/components/ui/meter";
import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import {
  BATTLE_META,
  MODELLED_SOURCE_NOTE,
  THREAT_META,
} from "@/lib/mock/competitors";
import type {
  BattleState,
  CompetitorMetric,
  ThreatLevel,
} from "@/types/competitor";

/**
 * The numbers above the workspace.
 *
 * Three readings of one selection: the headline figures, how dangerous the
 * tracked set is, and what the head-to-heads actually look like. All three
 * describe whichever competitors and terms are filtered in, and the panels say
 * so — a summary quietly describing a wider set than the table beneath it
 * would be worse than no summary.
 *
 * The battle bar counts contested rankings only. A term no rival ranks for has
 * no head-to-head in it, and folding those in would report uncontested terms
 * as wins.
 */
export function CompetitorSummary({
  metrics,
  threats,
  battles,
  contested,
  total,
  filtered,
}: {
  metrics: readonly CompetitorMetric[];
  threats: readonly { readonly level: ThreatLevel; readonly count: number }[];
  battles: readonly { readonly state: BattleState; readonly count: number }[];
  /** Contested rankings in the selection. */
  contested: number;
  /** Size of the whole competitor set. */
  total: number;
  /** Size of the current selection. */
  filtered: number;
}) {
  const narrowed = filtered !== total;
  const tracked = threats.reduce((carry, band) => carry + band.count, 0);

  return (
    <div className="space-y-4">
      <MetricTileGrid metrics={metrics} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Posture"
            title="How dangerous the tracked set is"
            description="Every rival in the selection, graded by what it is costing the project it competes in."
          />
          <PanelBody>
            {tracked === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-fg-subtle">
                No competitors in this selection.
              </p>
            ) : (
              <>
                <StackedMeter
                  label="Competitors by threat level"
                  segments={threats
                    .filter((band) => band.count > 0)
                    .map((band) => ({
                      id: band.level,
                      value: band.count,
                      tone: THREAT_META[band.level].meter,
                    }))}
                />

                <ul className="mt-3.5 grid gap-2 sm:grid-cols-2">
                  {threats.map((band) => (
                    <li
                      key={band.level}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-2"
                      title={THREAT_META[band.level].description}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            THREAT_DOT[band.level],
                          )}
                        />
                        <span className="truncate text-[12px] text-fg-muted">
                          {THREAT_META[band.level].label}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-2">
                        <span className="tabular text-[13px] font-semibold text-fg">
                          {band.count}
                        </span>
                        <span className="tabular text-[11px] text-fg-subtle">
                          {formatPercent((band.count / tracked) * 100, 0)}
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
                ? `Describing the ${filtered} competitors currently filtered in.`
                : `Describing all ${total} tracked competitors.`}
            </span>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Head-to-head"
            title="Where the contested terms stand"
            description="Every ranking in the selection with a rival on it, by what it would take to change the outcome."
          />
          <PanelBody>
            {contested === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-fg-subtle">
                No contested rankings in this selection.
              </p>
            ) : (
              <>
                <StackedMeter
                  label="Contested rankings by state"
                  segments={battles
                    .filter((band) => band.count > 0)
                    .map((band) => ({
                      id: band.state,
                      value: band.count,
                      tone: BATTLE_TONE[band.state],
                    }))}
                />

                <ul className="mt-3.5 space-y-2">
                  {battles
                    .filter((band) => band.count > 0)
                    .map((band) => (
                      <li
                        key={band.state}
                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-2"
                        title={BATTLE_META[band.state].description}
                      >
                        <span className="flex min-w-0 items-center gap-2 text-[12px] text-fg-muted">
                          <Icon
                            name={BATTLE_META[band.state].icon}
                            className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                          />
                          <span className="truncate">
                            {BATTLE_META[band.state].label}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-baseline gap-2">
                          <span className="tabular text-[13px] font-semibold text-fg">
                            {band.count}
                          </span>
                          <span className="tabular text-[11px] text-fg-subtle">
                            {formatPercent((band.count / contested) * 100, 0)}
                          </span>
                        </span>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </PanelBody>
          <PanelFooter>
            <span>{MODELLED_SOURCE_NOTE}</span>
          </PanelFooter>
        </Panel>
      </div>
    </div>
  );
}

const THREAT_DOT: Record<ThreatLevel, string> = {
  severe: "bg-critical",
  high: "bg-warning",
  moderate: "bg-accent",
  low: "bg-fg-subtle",
};

const BATTLE_TONE: Record<
  BattleState,
  "critical" | "warning" | "accent" | "positive" | "neutral"
> = {
  absent: "critical",
  losing: "critical",
  attack: "warning",
  "easy-win": "positive",
  "close-race": "accent",
  defend: "accent",
  dominant: "positive",
};
