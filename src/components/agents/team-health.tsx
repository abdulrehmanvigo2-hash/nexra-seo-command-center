import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompact, formatRelative } from "@/lib/format";
import { HEALTH_DOT, HEALTH_LABEL, HEALTH_METER } from "@/lib/health";
import { Meter } from "@/components/ui/meter";
import type { TeamHealth } from "@/types/agent";

/**
 * The health of the AI team, above the roster.
 *
 * Every figure is computed from the same agents the list below renders, so the
 * summary and the roster can never disagree. Filtering the list is a display
 * choice — these always describe the whole team, and say so.
 */
export function TeamHealthSummary({
  health,
  referenceIso,
}: {
  health: TeamHealth;
  referenceIso: string;
}) {
  return (
    <div className="space-y-3">
      <Panel as="div" className="flex flex-wrap items-center gap-x-8 gap-y-4 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-panel border",
              health.health === "positive"
                ? "border-positive/35 bg-positive/10 text-positive"
                : health.health === "neutral"
                  ? "border-accent/35 bg-accent-soft text-accent"
                  : health.health === "warning"
                    ? "border-warning/35 bg-warning/10 text-warning"
                    : "border-critical/35 bg-critical/10 text-critical",
            )}
          >
            <Icon name="agents" className="h-5 w-5" />
          </span>

          <div className="min-w-0">
            <p className="flex items-baseline gap-2">
              <span className="tabular text-[26px] leading-none font-semibold tracking-tight text-fg">
                {health.score}
              </span>
              <span className="text-[12px] font-medium text-fg-subtle">
                / 100
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    HEALTH_DOT[health.health],
                  )}
                />
                {HEALTH_LABEL[health.health]}
              </span>
            </p>
            <p className="mt-1.5 text-[11px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
              AI team health
            </p>
            <Meter
              className="mt-2 max-w-[220px]"
              size="sm"
              value={health.score}
              tone={HEALTH_METER[health.health]}
              label={`AI team health: ${health.score} out of 100`}
            />
          </div>
        </div>

        <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg-muted">
          {health.summary}
        </p>

        <dl className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <HeaderStat
            label="Working"
            value={`${health.workingAgents} / ${health.totalAgents}`}
            icon="bolt"
          />
          <HeaderStat
            label="Blocked"
            value={String(health.blockedAgents)}
            icon="alert"
            tone={health.blockedAgents > 0 ? "warning" : undefined}
          />
          <HeaderStat
            label="Active tasks"
            value={String(health.activeTasks)}
            icon="inbox"
          />
          <HeaderStat
            label="Outputs"
            value={formatCompact(health.completedOutputs)}
            icon="layers"
          />
          <HeaderStat
            label="Avg quality"
            value={String(health.averageQuality)}
            icon="sparkles"
          />
        </dl>

        <Badge tone="neutral" dot>
          <Icon name="refresh" className="h-3 w-3" />
          Synced {formatRelative(health.lastOrchestration, referenceIso)}
        </Badge>
      </Panel>

      <MetricTileGrid metrics={health.metrics} />
    </div>
  );
}

function HeaderStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: "bolt" | "alert" | "inbox" | "layers" | "sparkles";
  tone?: "warning";
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
        <Icon name={icon} className="h-3.5 w-3.5" />
        {label}
      </dt>
      <dd
        className={cn(
          "tabular mt-1 text-[15px] leading-none font-semibold",
          tone === "warning" ? "text-warning" : "text-fg",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
