import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber } from "@/lib/format";
import {
  ANOMALY_KIND_META,
  CONFIDENCE_META,
  DIRECTION_META,
  PAGE_STATE_META,
  PROVENANCE_META,
  SEGMENT_META,
  SIGNIFICANCE_META,
  VERDICT_META,
  WORK_KIND_META,
} from "@/lib/mock/analytics";
import type {
  AnalyticsDistributionRow,
  AnalyticsProvenance,
  AnomalyKind,
  Confidence,
  LearningVerdict,
  MovementDirection,
  MovementSignificance,
  PagePerformanceState,
  SegmentDimension,
  WorkKind,
} from "@/types/analytics";

/**
 * The pieces of analytics display that appear in more than one place.
 *
 * A significance band, a direction, a confidence level and a page state read
 * the same on the overview, in a table row, on a project page and on the
 * Command Center because all of them render these components.
 *
 * The wording is load-bearing. Nothing below can be made to say a piece of
 * work caused a movement — the vocabulary does not contain the claim, and
 * these components are where that guarantee reaches the screen.
 */

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

export function SignificanceBadge({
  significance,
}: {
  significance: MovementSignificance;
}) {
  const meta = SIGNIFICANCE_META[significance];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

/**
 * A percentage change, with its direction.
 *
 * A change inside the noise band is drawn flat and grey whatever its sign: an
 * arrow on a 2% move implies a direction the data does not have.
 */
export function DeltaValue({
  delta,
  direction,
  className,
}: {
  delta: number;
  direction: MovementDirection;
  className?: string;
}) {
  const meta = DIRECTION_META[direction];

  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1 font-medium whitespace-nowrap",
        direction === "up"
          ? "text-positive"
          : direction === "down"
            ? "text-critical"
            : "text-fg-subtle",
        className,
      )}
      title={meta.description}
    >
      {direction !== "flat" && (
        <Icon
          name={direction === "up" ? "trend-up" : "trend-down"}
          className="h-3.5 w-3.5 shrink-0"
        />
      )}
      {delta > 0 ? "+" : ""}
      {delta}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function PageStateBadge({ state }: { state: PagePerformanceState }) {
  const meta = PAGE_STATE_META[state];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function VerdictBadge({ verdict }: { verdict: LearningVerdict }) {
  const meta = VERDICT_META[verdict];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function AnomalyKindBadge({ kind }: { kind: AnomalyKind }) {
  const meta = ANOMALY_KIND_META[kind];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function WorkKindBadge({ kind }: { kind: WorkKind }) {
  const meta = WORK_KIND_META[kind];
  return (
    <Badge tone="neutral" title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function SegmentBadge({ dimension }: { dimension: SegmentDimension }) {
  const meta = SEGMENT_META[dimension];
  return (
    <Badge tone="neutral" title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

/**
 * How much a reading can be trusted.
 *
 * `No confidence` is a real state and is shown as such rather than hidden —
 * a movement nothing explains is a more useful thing to say than a plausible
 * story about it.
 */
export function ConfidenceTag({
  confidence,
  className,
}: {
  confidence: Confidence;
  className?: string;
}) {
  const meta = CONFIDENCE_META[confidence];
  return (
    <span
      className={cn(
        "text-[10.5px] font-medium tracking-[0.04em] whitespace-nowrap uppercase",
        confidence === "high"
          ? "text-positive"
          : confidence === "low"
            ? "text-warning"
            : "text-fg-subtle",
        className,
      )}
      title={meta.description}
    >
      {meta.label}
    </span>
  );
}

export function ProvenanceTag({
  provenance,
  className,
}: {
  provenance: AnalyticsProvenance;
  className?: string;
}) {
  const meta = PROVENANCE_META[provenance];
  return (
    <span
      className={cn(
        "text-[10.5px] font-medium tracking-[0.04em] whitespace-nowrap text-fg-subtle uppercase",
        className,
      )}
      title={meta.description}
    >
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Estimated monthly sessions. */
export function TrafficValue({
  sessions,
  className,
}: {
  sessions: number;
  className?: string;
}) {
  if (sessions <= 0) {
    return <span className={cn("text-fg-subtle", className)}>—</span>;
  }
  return (
    <span
      className={cn("tabular text-fg-muted", className)}
      title={`About ${formatNumber(sessions)} sessions a month`}
    >
      {formatCompact(sessions)}
    </span>
  );
}

/**
 * Sessions carried against sessions available.
 *
 * Shown as a proportion rather than as two numbers, because the question a
 * reader is asking is how much of the page is already working.
 */
export function HeadroomBar({
  traffic,
  potential,
}: {
  traffic: number;
  potential: number;
}) {
  const share = potential <= 0 ? 0 : Math.round((traffic / potential) * 100);

  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular w-9 text-right text-fg-muted">{share}%</span>
      <span className="hidden w-14 sm:block">
        <Meter
          size="sm"
          value={share}
          tone={share >= 55 ? "positive" : share >= 25 ? "warning" : "critical"}
          label={`Carrying ${share}% of this page's potential`}
        />
      </span>
    </span>
  );
}

/** A 0-100 association reading, with its bar. */
export function AssociationValue({ association }: { association: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular w-6 text-right font-semibold text-fg">
        {association}
      </span>
      <span className="hidden w-12 sm:block">
        <Meter
          size="sm"
          value={association}
          tone={association >= 72 ? "accent" : "neutral"}
          label={`Association ${association} out of 100 — not a measure of cause`}
        />
      </span>
    </span>
  );
}

/** One of our pages, linked to its content record. */
export function PageLink({
  contentId,
  title,
  path,
}: {
  contentId: string;
  title: string;
  path: string;
}) {
  return (
    <span className="block min-w-0">
      <Link
        href={`/content/${contentId}`}
        className="block truncate font-medium text-fg transition-colors hover:text-accent"
        title={title}
      >
        {title}
      </Link>
      <span
        className="block truncate font-mono text-[11px] text-fg-subtle"
        title={path}
      >
        {path}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

const BAR_TONE: Record<AnalyticsDistributionRow["tone"], string> = {
  positive: "bg-positive",
  accent: "bg-accent",
  warning: "bg-warning",
  critical: "bg-critical",
  neutral: "bg-fg-subtle",
};

export function DistributionList({
  rows,
  emptyLabel = "Nothing to show for this selection.",
}: {
  rows: readonly AnalyticsDistributionRow[];
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-[12px] text-fg-subtle">{emptyLabel}</p>;
  }

  const peak = Math.max(...rows.map((row) => row.count), 1);

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.id} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className="min-w-0 truncate text-[12.5px] font-medium text-fg"
              title={row.description}
            >
              {row.label}
            </span>
            <span className="tabular shrink-0 text-[11.5px] text-fg-subtle">
              {row.count}
              <span className="ml-1.5 text-fg-subtle/70">{row.share}%</span>
            </span>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-raised"
            role="progressbar"
            aria-valuenow={row.count}
            aria-valuemin={0}
            aria-valuemax={peak}
            aria-label={`${row.label}: ${row.count}, ${row.share}%`}
          >
            <div
              className={cn("h-full rounded-full", BAR_TONE[row.tone])}
              style={{ width: `${Math.round((row.count / peak) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
