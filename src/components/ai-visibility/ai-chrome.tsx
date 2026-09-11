import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import {
  CITATION_META,
  CONFIDENCE_META,
  EFFORT_META,
  ENTITY_BAND_META,
  ENTITY_TYPE_META,
  EVIDENCE_BAND_META,
  EVIDENCE_KIND_META,
  GAIN_BAND_META,
  GAP_META,
  OPPORTUNITY_KIND_META,
  PROVENANCE_META,
  READINESS_META,
  SEVERITY_META,
  TOPIC_STATE_META,
} from "@/lib/mock/ai-visibility";
import type {
  AiDistributionRow,
  AiEffort,
  AiGapKind,
  AiOpportunityKind,
  AiProvenance,
  AiScore,
  AiSeverity,
  CitationState,
  Confidence,
  EntityStrengthBand,
  EntityType,
  EvidenceBand,
  EvidenceKind,
  GainBand,
  ReadinessBand,
  TopicCoverageState,
} from "@/types/ai-visibility";

/**
 * The pieces of AI-visibility display that appear in more than one place.
 *
 * A readiness band, a citation state, a confidence level and a published score
 * read the same on the overview, in a table row, on a content page and on the
 * Command Center because all of them render these components.
 *
 * Wording is load-bearing here. Nothing below can be made to say a page *was*
 * cited or surfaced by an answer engine — the vocabulary does not contain the
 * claim, and these components are where that guarantee reaches the screen.
 */

// ---------------------------------------------------------------------------
// Bands and states
// ---------------------------------------------------------------------------

export function ReadinessBadge({
  band,
  score,
}: {
  band: ReadinessBand;
  /** Shown after the label where the number adds something. */
  score?: number;
}) {
  const meta = READINESS_META[band];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
      {score !== undefined && (
        <span className="tabular font-normal opacity-80">{score}</span>
      )}
    </Badge>
  );
}

export function CitationBadge({ state }: { state: CitationState }) {
  const meta = CITATION_META[state];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function EvidenceBadge({ band }: { band: EvidenceBand }) {
  const meta = EVIDENCE_BAND_META[band];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function GainBadge({ band }: { band: GainBand }) {
  const meta = GAIN_BAND_META[band];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function TopicStateBadge({ state }: { state: TopicCoverageState }) {
  const meta = TOPIC_STATE_META[state];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function EntityBandBadge({ band }: { band: EntityStrengthBand }) {
  const meta = ENTITY_BAND_META[band];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function EntityTypeBadge({ type }: { type: EntityType }) {
  const meta = ENTITY_TYPE_META[type];
  return (
    <Badge tone="neutral" title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: AiSeverity }) {
  const meta = SEVERITY_META[severity];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function EffortBadge({ effort }: { effort: AiEffort }) {
  const meta = EFFORT_META[effort];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function GapKindBadge({ kind }: { kind: AiGapKind }) {
  const meta = GAP_META[kind];
  return (
    <Badge tone="neutral" title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function OpportunityKindBadge({ kind }: { kind: AiOpportunityKind }) {
  const meta = OPPORTUNITY_KIND_META[kind];
  return (
    <Badge tone="neutral" title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function EvidenceKindBadge({ kind }: { kind: EvidenceKind }) {
  const meta = EVIDENCE_KIND_META[kind];
  return (
    <Badge
      tone={kind === "unsupported-claim" ? "critical" : "neutral"}
      title={meta.description}
    >
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

/**
 * How much a reading can be trusted.
 *
 * Shown wherever a figure rests on a modelled inference. `Unknown` is a real
 * state and is displayed as such rather than as a low number — a different
 * statement, and the honest one.
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
        "inline-flex items-center gap-1 text-[10.5px] font-medium tracking-[0.04em] whitespace-nowrap uppercase",
        confidence === "unknown"
          ? "text-fg-subtle"
          : confidence === "low"
            ? "text-warning"
            : "text-fg-subtle/80",
        className,
      )}
      title={meta.description}
    >
      {meta.label}
    </span>
  );
}

/** Where a figure came from. Every reading in this module is one of two. */
export function ProvenanceTag({
  provenance,
  className,
}: {
  provenance: AiProvenance;
  className?: string;
}) {
  const meta = PROVENANCE_META[provenance];
  return (
    <span
      className={cn(
        "text-[10.5px] font-medium tracking-[0.04em] whitespace-nowrap uppercase text-fg-subtle",
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

/** The tone a 0-100 AI score should be drawn in. */
export function toneForScore(
  score: number,
): "positive" | "accent" | "warning" | "critical" {
  if (score >= 80) return "positive";
  if (score >= 65) return "accent";
  if (score >= 45) return "warning";
  return "critical";
}

/** A 0-100 score with its bar, for dense table rows. */
export function ScoreValue({
  score,
  label,
}: {
  score: number;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular w-6 text-right font-semibold text-fg">
        {score}
      </span>
      <span className="hidden w-12 sm:block">
        <Meter
          size="sm"
          value={score}
          tone={toneForScore(score)}
          label={`${label} ${score} out of 100`}
        />
      </span>
    </span>
  );
}

/** A larger read-out of a 0-100 score, for panels. */
export function ScoreReading({
  score,
  caption,
  label,
  detail,
}: {
  score: number;
  caption: string;
  label: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-fg-subtle">{caption}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className="tabular text-[22px] leading-none font-semibold text-fg">
          {score}
        </span>
        <span className="text-[11.5px] text-fg-subtle">/ 100</span>
      </p>
      <Meter
        className="mt-2"
        value={score}
        tone={toneForScore(score)}
        label={label}
      />
      {detail && (
        <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">
          {detail}
        </p>
      )}
    </div>
  );
}

/** A page title with its path, linked to its AI detail on the content page. */
export function AiPageLink({
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
        href={`/content/${contentId}?tab=ai`}
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

const BAR_TONE: Record<AiDistributionRow["tone"], string> = {
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
  rows: readonly AiDistributionRow[];
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

// ---------------------------------------------------------------------------
// Score breakdown
// ---------------------------------------------------------------------------

/**
 * A published score, taken apart.
 *
 * Every score in this module ships with its factors, their weights, what each
 * contributed, where it came from and how much confidence it carries — so the
 * number can be argued with instead of taken on trust, and a low-confidence
 * input is visible rather than buried in the total.
 */
export function ScoreBreakdownList({ score }: { score: AiScore }) {
  return (
    <ul className="space-y-2.5">
      {score.factors.map((factor) => (
        <li key={factor.id} className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="flex min-w-0 flex-wrap items-baseline gap-2 text-[12.5px] font-medium text-fg">
              <span className="truncate">{factor.label}</span>
              <ProvenanceTag provenance={factor.provenance} />
              <ConfidenceTag confidence={factor.confidence} />
            </span>
            <span className="tabular shrink-0 text-[11.5px] text-fg-muted">
              {factor.value} × {factor.weight.toFixed(2)} ={" "}
              <span className="font-semibold text-fg">
                {factor.contribution.toFixed(1)}
              </span>
            </span>
          </div>

          <Meter
            className="mt-1.5"
            size="sm"
            value={factor.value}
            tone={toneForScore(factor.value)}
            label={`${factor.label} scores ${factor.value} of 100`}
          />

          <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
            {factor.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}
