import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter, type MeterTone } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import { AGENT_NAMES } from "@/lib/mock/seo";
import { PROJECT_STATUS_META, PROJECT_TYPE_META } from "@/lib/mock/projects";
import type { MetricHealth } from "@/types/dashboard";
import type { AgentId } from "@/types/seo";
import type { ProjectStatus, ProjectType } from "@/types/project";

/**
 * The small repeated pieces of the Projects module: a status badge, a type
 * chip, a health reading, a project monogram, and the stack of assigned
 * agents.
 *
 * Shared by the cards, the table, and the project workspace so a project looks
 * the same wherever it is listed — and so a status is defined once rather than
 * three times.
 */

export const HEALTH_LABEL: Record<MetricHealth, string> = {
  positive: "Healthy",
  neutral: "Steady",
  warning: "Watch",
  negative: "At risk",
};

export const HEALTH_DOT: Record<MetricHealth, string> = {
  positive: "bg-positive",
  neutral: "bg-accent",
  warning: "bg-warning",
  negative: "bg-critical",
};

export const HEALTH_METER: Record<MetricHealth, MeterTone> = {
  positive: "positive",
  neutral: "accent",
  warning: "warning",
  negative: "critical",
};

/** Health band for a bare 0-100 score. */
export function healthOf(score: number): MetricHealth {
  if (score >= 75) return "positive";
  if (score >= 60) return "neutral";
  if (score >= 45) return "warning";
  return "negative";
}

export function ProjectStatusBadge({
  status,
  className,
}: {
  status: ProjectStatus;
  className?: string;
}) {
  const meta = PROJECT_STATUS_META[status];

  return (
    <Badge tone={meta.tone} dot className={className}>
      {meta.label}
    </Badge>
  );
}

export function ProjectTypeChip({
  type,
  className,
}: {
  type: ProjectType;
  className?: string;
}) {
  const meta = PROJECT_TYPE_META[type];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11.5px] text-fg-subtle",
        className,
      )}
    >
      <Icon name={meta.icon} className="h-3.5 w-3.5 shrink-0" />
      {meta.label}
    </span>
  );
}

/** The project's monogram tile. */
export function ProjectMonogram({
  initials,
  size = "md",
  className,
}: {
  initials: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-raised font-semibold text-fg-muted",
        size === "sm" && "h-7 w-7 text-[10.5px]",
        size === "md" && "h-9 w-9 text-[11.5px]",
        size === "lg" && "h-11 w-11 text-[13px]",
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** Score, bar, and the word for the band it falls in. */
export function HealthReading({
  score,
  health,
  label,
  className,
}: {
  score: number;
  health: MetricHealth;
  /** Accessible name for the bar, e.g. "Halcyon Fintech SEO health". */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="tabular text-[17px] leading-none font-semibold text-fg">
          {score}
          <span className="ml-0.5 text-[11px] font-medium text-fg-subtle">
            / 100
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 rounded-full", HEALTH_DOT[health])}
          />
          {HEALTH_LABEL[health]}
        </span>
      </div>
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

/** Two-letter monogram for an agent, e.g. "Technical SEO" -> "TS". */
export function agentInitials(agent: AgentId): string {
  const words = AGENT_NAMES[agent]
    .split(/[\s&/]+/)
    .filter((word) => word.length > 0 && word !== "and");

  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** The assigned agents, as a row of monograms with an overflow count. */
export function AgentStack({
  agents,
  max = 4,
  className,
}: {
  agents: readonly AgentId[];
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
            key={agent}
            title={AGENT_NAMES[agent]}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-[9.5px] font-semibold text-fg-subtle"
          >
            {agentInitials(agent)}
            <span className="sr-only">{AGENT_NAMES[agent]}</span>
          </span>
        ))}
      </span>
      {overflow > 0 && (
        <span className="ml-2 text-[11px] text-fg-subtle">+{overflow}</span>
      )}
    </span>
  );
}
