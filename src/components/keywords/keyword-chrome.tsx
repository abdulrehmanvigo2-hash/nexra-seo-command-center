import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents";
import {
  DIFFICULTY_BAND_META,
  INTENT_META,
  KEYWORD_STATUS_META,
  OPPORTUNITY_BAND_META,
  RANKING_STATUS_META,
  SERP_FEATURE_META,
  difficultyBandOf,
  opportunityBandOf,
} from "@/lib/mock/keywords";
import type {
  AgentId,
  KeywordIntent,
  KeywordPriorityScore,
  KeywordRecord,
  KeywordStatus,
  RankingStatus,
  SerpFeaturePresence,
} from "@/types/keyword";

/**
 * The pieces of keyword display that appear in more than one place.
 *
 * A position reads the same on the table, the detail page, the movement lists,
 * and the cluster workspace because all four render the same component. That
 * matters more here than in most modules: a position, a change, and a
 * difficulty are the three things somebody scans hundreds of times, and a
 * second rendering of any of them would be a second definition of it.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function IntentBadge({
  intent,
  short = false,
}: {
  intent: KeywordIntent;
  /** Abbreviates the label — for dense table rows. */
  short?: boolean;
}) {
  const meta = INTENT_META[intent];

  return (
    <Badge tone={meta.tone} className={short ? "px-1.5" : undefined}>
      <span className={short ? "sm:hidden" : "hidden"}>{meta.short}</span>
      <span className={short ? "hidden sm:inline" : undefined}>
        {meta.label}
      </span>
    </Badge>
  );
}

export function KeywordStatusBadge({ status }: { status: KeywordStatus }) {
  const meta = KEYWORD_STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function RankingBadge({ status }: { status: RankingStatus }) {
  const meta = RANKING_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.short}</Badge>;
}

/** A keyword's name, linked to its workspace. */
export function KeywordLink({
  id,
  keyword,
  className,
}: {
  id: string;
  keyword: string;
  className?: string;
}) {
  return (
    <Link
      href={`/keywords/${id}`}
      className={cn(
        "font-medium text-fg transition-colors hover:text-accent",
        className,
      )}
    >
      {keyword}
    </Link>
  );
}

/** An agent's name, linked to its workspace in the Agents module. */
export function OwnerLink({
  agent,
  className,
}: {
  agent: AgentId;
  className?: string;
}) {
  return (
    <Link
      href={`/agents/${agent}`}
      className={cn(
        "inline-flex items-center gap-1.5 text-fg-muted transition-colors hover:text-accent",
        className,
      )}
    >
      <Icon name="agents" className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
      <span className="truncate">{AGENT_NAMES[agent]}</span>
    </Link>
  );
}

/** A project's name, linked to its workspace in the Projects module. */
export function ProjectLink({
  projectId,
  projectName,
  className,
}: {
  projectId: string;
  projectName: string;
  className?: string;
}) {
  return (
    <Link
      href={`/projects/${projectId}`}
      className={cn(
        "truncate text-fg-muted transition-colors hover:text-accent",
        className,
      )}
    >
      {projectName}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** A SERP position, or an honest dash where the keyword does not rank. */
export function PositionValue({
  position,
  className,
}: {
  position: number | null;
  className?: string;
}) {
  if (position === null) {
    return (
      <span className={cn("text-fg-subtle", className)} title="Not ranking in the top 100">
        —
      </span>
    );
  }

  return (
    <span
      className={cn(
        "tabular font-medium",
        position <= 3
          ? "text-positive"
          : position <= 10
            ? "text-fg"
            : "text-fg-muted",
        className,
      )}
    >
      {position}
    </span>
  );
}

/**
 * Places gained or lost.
 *
 * Positive is an improvement, because a keyword moving from 14 to 9 gained
 * five places even though its number went down. Direction is carried by the
 * arrow as well as the colour.
 */
export function ChangeValue({
  change,
  className,
}: {
  change: number;
  className?: string;
}) {
  if (change === 0) {
    return <span className={cn("text-fg-subtle", className)}>—</span>;
  }

  const gained = change > 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        gained ? "text-positive" : "text-critical",
        className,
      )}
    >
      <Icon
        name={gained ? "trend-up" : "trend-down"}
        className="h-3.5 w-3.5 shrink-0"
      />
      <span className="tabular">
        {gained ? "+" : "−"}
        {Math.abs(change)}
      </span>
      <span className="sr-only">
        places {gained ? "gained" : "lost"}
      </span>
    </span>
  );
}

/** Difficulty with its band colour, and a bar on wider screens. */
export function DifficultyValue({
  difficulty,
  showMeter = true,
}: {
  difficulty: number;
  showMeter?: boolean;
}) {
  const meta = DIFFICULTY_BAND_META[difficultyBandOf(difficulty)];

  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular w-6 text-right font-medium text-fg-muted">
        {difficulty}
      </span>
      {showMeter && (
        <span className="hidden w-12 sm:block">
          <Meter
            size="sm"
            value={difficulty}
            tone={meta.tone}
            label={`Difficulty ${difficulty} out of 100 — ${meta.label}`}
          />
        </span>
      )}
    </span>
  );
}

/** The Nexra opportunity score, with its band. */
export function OpportunityValue({
  score,
  showMeter = true,
}: {
  score: number;
  showMeter?: boolean;
}) {
  const meta = OPPORTUNITY_BAND_META[opportunityBandOf(score)];

  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular w-6 text-right font-semibold text-fg">
        {score}
      </span>
      {showMeter && (
        <span className="hidden w-12 sm:block">
          <Meter
            size="sm"
            value={score}
            tone={meta.meter}
            label={`Opportunity score ${score} out of 100 — ${meta.label}`}
          />
        </span>
      )}
    </span>
  );
}

/** A larger read-out of a score, for panels rather than table rows. */
export function ScoreReading({
  score,
  label,
  caption,
  tone,
}: {
  score: number;
  /** Accessible name for the bar. */
  label: string;
  caption: string;
  tone?: "accent" | "positive" | "warning" | "critical" | "neutral";
}) {
  const band = OPPORTUNITY_BAND_META[opportunityBandOf(score)];

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
        tone={tone ?? band.meter}
        label={label}
      />
    </div>
  );
}

/** Volume, abbreviated, with the full figure available on hover. */
export function VolumeValue({ volume }: { volume: number }) {
  return (
    <span
      className="tabular text-fg-muted"
      title={`${formatNumber(volume)} searches a month`}
    >
      {formatCompact(volume)}
    </span>
  );
}

/** A target URL, or a clear statement that no page exists. */
export function TargetUrl({
  url,
  className,
}: {
  url: string | null;
  className?: string;
}) {
  if (url === null) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11.5px] text-warning",
          className,
        )}
      >
        <Icon name="alert" className="h-3.5 w-3.5 shrink-0" />
        No page
      </span>
    );
  }

  return (
    <span
      className={cn(
        "block truncate font-mono text-[11.5px] text-fg-subtle",
        className,
      )}
      title={url}
    >
      {url}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SERP
// ---------------------------------------------------------------------------

/** The features on a keyword's result page, as compact chips. */
export function SerpFeatureChips({
  features,
  limit = 3,
}: {
  features: readonly SerpFeaturePresence[];
  limit?: number;
}) {
  if (features.length === 0) {
    return <span className="text-[11.5px] text-fg-subtle">None detected</span>;
  }

  const shown = features.slice(0, limit);
  const hidden = features.length - shown.length;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((entry) => {
        const meta = SERP_FEATURE_META[entry.feature];
        return (
          <span
            key={entry.feature}
            title={`${meta.label} — ${entry.ownership === "ours" ? "held by us" : entry.ownership === "competitor" ? `held by ${entry.holder ?? "a rival"}` : "unclaimed"}`}
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded border",
              entry.ownership === "ours"
                ? "border-positive/40 bg-positive/10 text-positive"
                : entry.ownership === "competitor"
                  ? "border-warning/35 bg-warning/10 text-warning"
                  : "border-border-strong bg-surface-raised text-fg-subtle",
            )}
          >
            <Icon name={meta.icon} className="h-3 w-3" />
            <span className="sr-only">{meta.label}</span>
          </span>
        );
      })}
      {hidden > 0 && (
        <span className="text-[11px] text-fg-subtle">+{hidden}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Score breakdown
// ---------------------------------------------------------------------------

/**
 * The opportunity score, taken apart.
 *
 * Published with its weights so the number can be argued with. It is a
 * weighted sum over the mock dataset — arithmetic, not a model — and the
 * footnote on the panel says exactly that rather than implying more.
 */
export function ScoreBreakdown({ score }: { score: KeywordPriorityScore }) {
  return (
    <ul className="space-y-2">
      {score.factors.map((factor) => (
        <li key={factor.id} className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="flex min-w-0 items-baseline gap-2 text-[12.5px] font-medium text-fg">
              <span className="truncate">{factor.label}</span>
              <span className="tabular shrink-0 text-[10.5px] font-normal text-fg-subtle">
                weight {Math.round(factor.weight * 100)}%
              </span>
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
                ? "positive"
                : factor.value >= 45
                  ? "accent"
                  : "warning"
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

// ---------------------------------------------------------------------------
// Row summary
// ---------------------------------------------------------------------------

/** One line describing a keyword, used in dense lists and dialogs. */
export function KeywordSummaryLine({ record }: { record: KeywordRecord }) {
  return (
    <span className="text-[11.5px] text-fg-subtle">
      {record.projectName} · {record.clusterName} ·{" "}
      {formatCompact(record.volume)} / mo ·{" "}
      {record.position === null
        ? "not ranking"
        : `position ${record.position}`}
    </span>
  );
}
