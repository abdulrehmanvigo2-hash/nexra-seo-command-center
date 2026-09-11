import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber } from "@/lib/format";
import {
  BATTLE_META,
  COMPETITOR_TYPE_META,
  DOMINANCE_META,
  GAP_KIND_META,
  OPPORTUNITY_KIND_META,
  OVERLAP_META,
  PROVENANCE_META,
  THREAT_KIND_META,
  THREAT_META,
} from "@/lib/mock/competitors";
import type {
  BattleState,
  CompetitorGapKind,
  CompetitorType,
  DominanceState,
  OpportunityKind,
  OverlapType,
  Provenance,
  ScoreBreakdown,
  ThreatKind,
  ThreatLevel,
} from "@/types/competitor";

/**
 * The pieces of competitor display that appear in more than one place.
 *
 * A threat level, a battle state, a rank gap, and a published score read the
 * same on the overview, in a table row, on a competitor's own page, and in a
 * comparison because all of them render these components.
 *
 * Identity chrome that is not specific to competitors — an agent link, a
 * project link, a keyword link, a position, a volume, an intent badge — is
 * re-exported from the Keyword Intelligence module rather than written again,
 * so there is one rendering of each in the product rather than three.
 */

export {
  ChangeValue,
  DifficultyValue,
  IntentBadge,
  KeywordLink,
  OpportunityValue,
  OwnerLink,
  PositionValue,
  ProjectLink,
  VolumeValue,
} from "@/components/keywords/keyword-chrome";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** A rival's name, linked to its workspace. */
export function CompetitorLink({
  id,
  name,
  className,
}: {
  id: string;
  name: string;
  className?: string;
}) {
  return (
    <Link
      href={`/competitors/${id}`}
      className={cn(
        "font-medium text-fg transition-colors hover:text-accent",
        className,
      )}
    >
      {name}
    </Link>
  );
}

/**
 * A rival's domain.
 *
 * Rendered as text, never as an outbound link: every domain in this product is
 * invented for the demo on the reserved `.example` TLD, and linking to one
 * would be a control that goes nowhere.
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

/**
 * A page of theirs.
 *
 * Same reasoning as the domain: shown as a path so it reads as a page, but not
 * linked, because there is nothing behind it.
 */
export function CompetitorPageUrl({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const path = url.replace(/^https?:\/\/[^/]+/, "") || "/";

  return (
    <span
      className={cn("block truncate font-mono text-[11.5px] text-fg-subtle", className)}
      title={url}
    >
      {path}
    </span>
  );
}

export function ThreatBadge({
  level,
  score,
}: {
  level: ThreatLevel;
  /** Shown after the label where the number adds something. */
  score?: number;
}) {
  const meta = THREAT_META[level];

  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
      {score !== undefined && (
        <span className="tabular font-normal opacity-80">{score}</span>
      )}
    </Badge>
  );
}

/**
 * The state of one head-to-head.
 *
 * Null is a real state and gets its own treatment: a term nobody else ranks
 * for is not a battle we are winning, it is a term with no battle in it.
 */
export function BattleBadge({
  battle,
  short = false,
}: {
  battle: BattleState | null;
  short?: boolean;
}) {
  if (battle === null) {
    return (
      <Badge tone="neutral" title="No rival ranks for this term.">
        Uncontested
      </Badge>
    );
  }

  const meta = BATTLE_META[battle];

  return (
    <Badge tone={meta.tone} title={`${meta.description} ${meta.action}`}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {short ? meta.short : meta.label}
    </Badge>
  );
}

export function OverlapBadge({ overlap }: { overlap: OverlapType }) {
  const meta = OVERLAP_META[overlap];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function CompetitorTypeBadge({ type }: { type: CompetitorType }) {
  const meta = COMPETITOR_TYPE_META[type];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function DominanceBadge({ state }: { state: DominanceState }) {
  const meta = DOMINANCE_META[state];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function GapKindBadge({ kind }: { kind: CompetitorGapKind }) {
  const meta = GAP_KIND_META[kind];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function ThreatKindBadge({ kind }: { kind: ThreatKind }) {
  const meta = THREAT_KIND_META[kind];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function OpportunityKindBadge({ kind }: { kind: OpportunityKind }) {
  const meta = OPPORTUNITY_KIND_META[kind];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

/**
 * Where a number came from.
 *
 * Shown next to anything the product did not measure, so a modelled figure is
 * never mistaken for an observed one.
 */
export function ProvenanceTag({
  provenance,
  className,
}: {
  provenance: Provenance;
  className?: string;
}) {
  const meta = PROVENANCE_META[provenance];

  return (
    <span
      className={cn(
        "text-[10.5px] font-medium tracking-[0.04em] whitespace-nowrap uppercase",
        provenance === "seeded" ? "text-fg-subtle" : "text-fg-subtle/80",
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

/**
 * Places between us and them.
 *
 * Positive means we are ahead, which is the opposite of the raw subtraction a
 * reader would do in their head — their position minus ours is positive when
 * their number is bigger, and a bigger position number is worse. The sign is
 * therefore always shown with a word beside it rather than alone.
 */
export function RankGap({ gap }: { gap: number | null }) {
  if (gap === null) {
    return (
      <span className="text-fg-subtle" title="Only one side ranks for this term">
        —
      </span>
    );
  }

  if (gap === 0) {
    return <span className="tabular text-fg-muted">level</span>;
  }

  const ahead = gap > 0;

  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1 font-medium whitespace-nowrap",
        ahead ? "text-positive" : "text-critical",
      )}
      title={
        ahead
          ? `We are ${Math.abs(gap)} places ahead`
          : `They are ${Math.abs(gap)} places ahead`
      }
    >
      <Icon
        name={ahead ? "trend-up" : "trend-down"}
        className="h-3.5 w-3.5 shrink-0"
      />
      {Math.abs(gap)}
      <span className="text-[10.5px] font-normal text-fg-subtle">
        {ahead ? "ahead" : "behind"}
      </span>
    </span>
  );
}

/** A 0-100 module score with its bar, for dense table rows. */
export function ScoreValue({
  score,
  label,
  tone = "accent",
}: {
  score: number;
  /** Accessible name for the bar, e.g. "Threat score". */
  label: string;
  tone?: "accent" | "positive" | "warning" | "critical" | "neutral";
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
          tone={tone}
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
  tone = "accent",
  detail,
}: {
  score: number;
  caption: string;
  label: string;
  tone?: "accent" | "positive" | "warning" | "critical" | "neutral";
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
      <Meter className="mt-2" value={score} tone={tone} label={label} />
      {detail && (
        <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">
          {detail}
        </p>
      )}
    </div>
  );
}

/** Estimated monthly sessions, abbreviated. */
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
 * A page of ours competing with one of theirs, or an honest gap.
 *
 * The absence is the finding, so it is stated rather than left as a dash.
 */
export function OurPageCell({
  contentId,
  title,
  score,
}: {
  contentId: string | null;
  title: string | null;
  score: number | null;
}) {
  if (contentId === null || title === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] whitespace-nowrap text-warning">
        <Icon name="link-off" className="h-3.5 w-3.5 shrink-0" />
        Nothing of ours
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <Link
        href={`/content/${contentId}`}
        className="truncate text-fg-muted transition-colors hover:text-accent"
        title={title}
      >
        {title}
      </Link>
      {score !== null && (
        <span
          className="tabular shrink-0 text-[11px] text-fg-subtle"
          title={`Content score ${score} out of 100`}
        >
          {score}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Score breakdown
// ---------------------------------------------------------------------------

/**
 * A published score, taken apart.
 *
 * Every score in this module ships with its factors, their weights, and what
 * each contributed, so a number can be argued with instead of taken on trust.
 * The provenance tag on each row says whether the reading was measured,
 * derived, or modelled — which is the difference between a figure worth acting
 * on and one worth checking first.
 */
export function ScoreBreakdownList({ score }: { score: ScoreBreakdown }) {
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
            tone={
              factor.value >= 70
                ? "critical"
                : factor.value >= 45
                  ? "warning"
                  : "accent"
            }
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

/** One line describing a rival, for dense lists and dialogs. */
export function CompetitorSummaryLine({
  domain,
  projectName,
  keywordFootprint,
  sharedKeywords,
}: {
  domain: string;
  projectName: string;
  keywordFootprint: number;
  sharedKeywords: number;
}) {
  return (
    <span className="text-[11.5px] text-fg-subtle">
      {domain} · {projectName} · {keywordFootprint} terms ranked ·{" "}
      {sharedKeywords} contested
    </span>
  );
}
