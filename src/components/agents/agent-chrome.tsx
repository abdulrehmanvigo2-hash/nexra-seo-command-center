import { Icon } from "@/components/icons";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import { HEALTH_DOT, HEALTH_LABEL, HEALTH_METER } from "@/lib/health";
import {
  AGENT_CATEGORY_META,
  AGENT_STATUS_META,
  WORKLOAD_META,
} from "@/lib/mock/agents";
import type { MetricHealth } from "@/types/dashboard";
import type {
  AgentCategory,
  AgentStatus,
  AgentWorkload,
} from "@/types/agent";

/**
 * The small repeated pieces of the Agents module: a status badge, a workload
 * reading, a category chip, and an agent's monogram.
 *
 * Shared by the cards, the table, the pipeline, and the agent workspace, so an
 * agent looks the same wherever it appears and a status is defined once rather
 * than four times.
 */

export function AgentStatusBadge({
  status,
  className,
}: {
  status: AgentStatus;
  className?: string;
}) {
  const meta = AGENT_STATUS_META[status];

  return (
    <StatusBadge
      status={meta.status}
      label={meta.label}
      className={className}
    />
  );
}

export function AgentCategoryChip({
  category,
  className,
}: {
  category: AgentCategory;
  className?: string;
}) {
  const meta = AGENT_CATEGORY_META[category];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11.5px] text-fg-subtle",
        className,
      )}
      title={meta.description}
    >
      <Icon name={meta.icon} className="h-3.5 w-3.5 shrink-0" />
      {meta.label}
    </span>
  );
}

/**
 * The agent's monogram, with its stage in the loop.
 *
 * The stage number is part of the identity rather than decoration: which of
 * the twelve positions an agent holds is the first thing that explains what it
 * does and who it hands to.
 */
export function AgentMonogram({
  initials,
  stage,
  size = "md",
  className,
}: {
  initials: string;
  /** Position in the orchestration loop, shown as a corner badge. */
  stage?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-md border border-border-strong bg-surface-raised font-semibold text-fg-muted",
          size === "sm" && "h-7 w-7 text-[10.5px]",
          size === "md" && "h-9 w-9 text-[11.5px]",
          size === "lg" && "h-11 w-11 text-[13px]",
        )}
      >
        {initials}
      </span>
      {stage !== undefined && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -right-1.5 -bottom-1.5 flex items-center justify-center rounded-full border border-border-strong bg-surface font-semibold text-fg-subtle",
            size === "lg"
              ? "h-5 w-5 text-[10px]"
              : "h-[18px] w-[18px] text-[9.5px]",
          )}
        >
          {stage}
        </span>
      )}
    </span>
  );
}

/** Workload band, as a labelled chip. */
export function WorkloadBadge({
  workload,
  className,
}: {
  workload: AgentWorkload;
  className?: string;
}) {
  const meta = WORKLOAD_META[workload.band];

  return (
    <Badge tone={meta.tone} className={className} dot>
      {meta.label} · {workload.percent}%
    </Badge>
  );
}

/** Workload as a bar with its number, for cards and the workspace. */
export function WorkloadReading({
  workload,
  label,
  className,
}: {
  workload: AgentWorkload;
  /** Accessible name, e.g. "Writer workload". */
  label: string;
  className?: string;
}) {
  const meta = WORKLOAD_META[workload.band];

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-fg-subtle">Workload</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <span className="tabular font-medium text-fg-muted">
            {workload.percent}%
          </span>
          {meta.label}
        </span>
      </div>
      <Meter
        className="mt-1.5"
        size="sm"
        // Past capacity still reads as a full bar; the number beside it
        // carries how far past.
        value={Math.min(100, workload.percent)}
        tone={meta.meter}
        label={`${label}: ${workload.percent}% of capacity in use`}
      />
    </div>
  );
}

/** A 0-100 index with its band, used for quality and team health. */
export function ScoreReading({
  score,
  health,
  caption,
  label,
  className,
}: {
  score: number;
  health: MetricHealth;
  /** Wording above the number, e.g. "Quality score". */
  caption: string;
  /** Accessible name for the bar. */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-fg-subtle">{caption}</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 rounded-full", HEALTH_DOT[health])}
          />
          {HEALTH_LABEL[health]}
        </span>
      </div>
      <p className="tabular mt-1 text-[17px] leading-none font-semibold text-fg">
        {score}
        <span className="ml-0.5 text-[11px] font-medium text-fg-subtle">
          / 100
        </span>
      </p>
      <Meter
        className="mt-2"
        size="sm"
        value={score}
        tone={HEALTH_METER[health]}
        label={`${label}: ${score} out of 100`}
      />
    </div>
  );
}

/** The agents' monograms as a row, with an overflow count. */
export function AgentStack({
  agents,
  max = 4,
  className,
}: {
  agents: readonly { readonly id: string; readonly initials: string; readonly name: string }[];
  max?: number;
  className?: string;
}) {
  const shown = agents.slice(0, max);
  const overflow = agents.length - shown.length;

  return (
    <span className={cn("flex items-center", className)}>
      <span className="flex -space-x-1.5">
        {shown.map((agent) => (
          <span
            key={agent.id}
            title={agent.name}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-[9.5px] font-semibold text-fg-subtle"
          >
            {agent.initials}
            <span className="sr-only">{agent.name}</span>
          </span>
        ))}
      </span>
      {overflow > 0 && (
        <span className="ml-2 text-[11px] text-fg-subtle">+{overflow}</span>
      )}
    </span>
  );
}
