import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber } from "@/lib/format";
import {
  ANCHOR_META,
  CATEGORY_META,
  EFFORT_META,
  LINK_KIND_META,
  LINK_REL_META,
  LINK_STATUS_META,
  OUTREACH_KIND_META,
  OUTREACH_STAGE_META,
  PLACEMENT_META,
  PROVENANCE_META,
  QUALITY_META,
  RELATIONSHIP_META,
  RELEVANCE_META,
  SEVERITY_META,
  TOXIC_ACTION_META,
  TOXIC_SIGNAL_META,
} from "@/lib/mock/backlinks";
import type {
  AnchorKind,
  AuthorityScore,
  DomainCategory,
  DomainRelationship,
  LinkDistributionRow,
  LinkKind,
  LinkPlacement,
  LinkProvenance,
  LinkQualityBand,
  LinkRel,
  LinkSeverity,
  LinkStatus,
  OutreachEffort,
  OutreachKind,
  OutreachStage,
  RelevanceBand,
  ToxicAction,
  ToxicSignal,
} from "@/types/backlinks";

/**
 * The pieces of link display that appear in more than one place.
 *
 * A quality band, a link status, a relevance reading and a published score read
 * the same on the overview, in a table row, on a content page and on the
 * Command Center because all of them render these components.
 */

// ---------------------------------------------------------------------------
// Bands and states
// ---------------------------------------------------------------------------

export function QualityBadge({
  band,
  score,
}: {
  band: LinkQualityBand;
  /** Shown after the label where the number adds something. */
  score?: number;
}) {
  const meta = QUALITY_META[band];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
      {score !== undefined && (
        <span className="tabular font-normal opacity-80">{score}</span>
      )}
    </Badge>
  );
}

export function LinkStatusBadge({ status }: { status: LinkStatus }) {
  const meta = LINK_STATUS_META[status];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function RelBadge({ rel }: { rel: LinkRel }) {
  const meta = LINK_REL_META[rel];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function LinkKindBadge({ kind }: { kind: LinkKind }) {
  const meta = LINK_KIND_META[kind];
  return (
    <Badge tone="neutral" title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function PlacementBadge({ placement }: { placement: LinkPlacement }) {
  const meta = PLACEMENT_META[placement];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function AnchorBadge({ kind }: { kind: AnchorKind }) {
  const meta = ANCHOR_META[kind];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function CategoryBadge({ category }: { category: DomainCategory }) {
  const meta = CATEGORY_META[category];
  return (
    <Badge tone="neutral" title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function RelevanceBadge({ band }: { band: RelevanceBand }) {
  const meta = RELEVANCE_META[band];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function RelationshipBadge({
  relationship,
}: {
  relationship: DomainRelationship;
}) {
  const meta = RELATIONSHIP_META[relationship];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: LinkSeverity }) {
  const meta = SEVERITY_META[severity];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function EffortBadge({ effort }: { effort: OutreachEffort }) {
  const meta = EFFORT_META[effort];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function OutreachKindBadge({ kind }: { kind: OutreachKind }) {
  const meta = OUTREACH_KIND_META[kind];
  return (
    <Badge tone="neutral" title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function StageBadge({ stage }: { stage: OutreachStage }) {
  const meta = OUTREACH_STAGE_META[stage];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function ToxicSignalBadge({ signal }: { signal: ToxicSignal }) {
  const meta = TOXIC_SIGNAL_META[signal];
  return (
    <Badge
      tone={
        meta.severity === "critical" || meta.severity === "high"
          ? "critical"
          : meta.severity === "medium"
            ? "warning"
            : "neutral"
      }
      title={`${meta.description} ${meta.impact}`}
    >
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function ToxicActionBadge({ action }: { action: ToxicAction }) {
  const meta = TOXIC_ACTION_META[action];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

/** Where a figure came from. Every reading in this module is one of two. */
export function ProvenanceTag({
  provenance,
  className,
}: {
  provenance: LinkProvenance;
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
// Identity
// ---------------------------------------------------------------------------

/**
 * A referring domain.
 *
 * Rendered as text, never as an outbound link: every domain in this module is
 * invented for the demo on the reserved `.example` TLD, and linking to one
 * would be a control that goes nowhere. Competitor Intelligence set the same
 * convention.
 */
export function DomainText({
  domain,
  className,
}: {
  domain: string;
  className?: string;
}) {
  return (
    <span
      className={cn("truncate font-mono text-[11.5px] text-fg-subtle", className)}
      title={`${domain} — a demo domain on the reserved .example TLD`}
    >
      {domain}
    </span>
  );
}

/** A domain's name over its host, for the domain table's identity column. */
export function DomainIdentity({
  name,
  domain,
}: {
  name: string;
  domain: string;
}) {
  return (
    <span className="block min-w-0">
      <span className="block truncate font-medium text-fg" title={name}>
        {name}
      </span>
      <DomainText domain={domain} className="block" />
    </span>
  );
}

/** One of our pages, linked to its content record. */
export function TargetPageLink({
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

/** Anchor text, shown with the kind it was classified as. */
export function AnchorText({ text }: { text: string }) {
  return (
    <span
      className="block max-w-[16rem] truncate text-[12px] text-fg-muted italic"
      title={text}
    >
      &ldquo;{text}&rdquo;
    </span>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** The tone a 0-100 authority figure should be drawn in. */
export function toneForScore(
  score: number,
): "positive" | "accent" | "warning" | "critical" {
  if (score >= 78) return "positive";
  if (score >= 62) return "accent";
  if (score >= 42) return "warning";
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

/** Modelled domain authority, which is the figure people look at first. */
export function AuthorityValue({ authority }: { authority: number }) {
  return (
    <span
      className={cn(
        "tabular font-semibold",
        authority >= 70
          ? "text-positive"
          : authority >= 45
            ? "text-fg"
            : "text-fg-muted",
      )}
      title="Modelled domain authority. No link-data provider is behind this figure."
    >
      {authority}
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

/** Modelled monthly referral sessions. */
export function ReferralValue({ sessions }: { sessions: number }) {
  if (sessions <= 0) {
    return <span className="text-fg-subtle">—</span>;
  }
  return (
    <span
      className="tabular text-fg-muted"
      title={`About ${formatNumber(sessions)} sessions a month`}
    >
      {formatCompact(sessions)}
    </span>
  );
}

/**
 * Links gained against links lost.
 *
 * Always shown as a pair: a net of zero can mean nothing happened or that
 * forty were won and forty lost, and those are different months.
 */
export function VelocityPair({
  gained,
  lost,
}: {
  gained: number;
  lost: number;
}) {
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap">
      <span className="tabular inline-flex items-center gap-1 font-medium text-positive">
        <Icon name="trend-up" className="h-3.5 w-3.5 shrink-0" />
        {gained}
      </span>
      <span className="tabular inline-flex items-center gap-1 font-medium text-critical">
        <Icon name="trend-down" className="h-3.5 w-3.5 shrink-0" />
        {lost}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

const BAR_TONE: Record<LinkDistributionRow["tone"], string> = {
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
  rows: readonly LinkDistributionRow[];
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
 * Every score in this module ships with its factors, their weights and what
 * each contributed, so a number can be argued with instead of taken on trust.
 */
export function ScoreBreakdownList({ score }: { score: AuthorityScore }) {
  return (
    <ul className="space-y-2.5">
      {score.factors.map((factor) => (
        <li key={factor.id} className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="flex min-w-0 items-baseline gap-2 text-[12.5px] font-medium text-fg">
              <span className="truncate">{factor.label}</span>
              <ProvenanceTag provenance={factor.provenance} />
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
