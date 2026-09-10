import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber } from "@/lib/format";
import {
  ALIGNMENT_META,
  FORMAT_META,
  HEALTH_META,
  MAPPING_META,
  ROLE_META,
  SCORE_BAND_META,
  STAGE_META,
  scoreBandOf,
} from "@/lib/mock/content";
import type {
  ContentFormat,
  ContentHealth,
  ContentRecord,
  ContentRole,
  ContentScore,
  ContentStage,
  IntentAlignment,
  MappingQuality,
} from "@/types/content";

/**
 * The pieces of content display that appear in more than one place.
 *
 * A stage, a score, and a page URL read the same on the inventory, the
 * workflow board, the detail workspace, and the coverage view because all four
 * render the same component. Identity chrome that is not specific to content —
 * an agent link, a project link, a keyword link, an intent badge — is imported
 * from the Keyword Intelligence module rather than written again here, so
 * there is one rendering of each in the product rather than two.
 */

export {
  ChangeValue,
  IntentBadge,
  KeywordLink,
  OwnerLink,
  PositionValue,
  ProjectLink,
  VolumeValue,
} from "@/components/keywords/keyword-chrome";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** A piece's title, linked to its workspace. */
export function ContentLink({
  id,
  title,
  className,
}: {
  id: string;
  title: string;
  className?: string;
}) {
  return (
    <Link
      href={`/content/${id}`}
      className={cn(
        "font-medium text-fg transition-colors hover:text-accent",
        className,
      )}
    >
      {title}
    </Link>
  );
}

export function StageBadge({
  stage,
  short = false,
}: {
  stage: ContentStage;
  /** Abbreviates the label — for dense table rows. */
  short?: boolean;
}) {
  const meta = STAGE_META[stage];

  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {short ? meta.short : meta.label}
    </Badge>
  );
}

export function HealthBadge({ health }: { health: ContentHealth }) {
  const meta = HEALTH_META[health];

  return (
    <Badge tone={meta.tone} title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function FormatBadge({ format }: { format: ContentFormat }) {
  const meta = FORMAT_META[format];

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11.5px] whitespace-nowrap text-fg-muted"
      title={meta.description}
    >
      <Icon name={meta.icon} className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
      {meta.label}
    </span>
  );
}

export function RoleBadge({ role }: { role: ContentRole }) {
  const meta = ROLE_META[role];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function AlignmentBadge({
  alignment,
  note,
}: {
  alignment: IntentAlignment;
  note?: string;
}) {
  const meta = ALIGNMENT_META[alignment];
  return (
    <Badge tone={meta.tone} title={note ?? meta.description}>
      {meta.label}
    </Badge>
  );
}

export function MappingBadge({ quality }: { quality: MappingQuality }) {
  const meta = MAPPING_META[quality];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/**
 * The content score, with its band.
 *
 * A piece that has not been written has nothing to score, and showing it a
 * near-zero number would read as a judgement rather than an absence. It gets a
 * dash and an explanation instead.
 */
export function ScoreValue({
  score,
  published,
  showMeter = true,
}: {
  score: number;
  published: boolean;
  showMeter?: boolean;
}) {
  if (!published) {
    return (
      <span className="text-fg-subtle" title="Not written yet, so there is nothing to score">
        —
      </span>
    );
  }

  const meta = SCORE_BAND_META[scoreBandOf(score)];

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
            label={`Content score ${score} out of 100 — ${meta.label}`}
          />
        </span>
      )}
    </span>
  );
}

/** A larger read-out of a 0-100 content reading, for panels. */
export function ScoreReading({
  score,
  caption,
  label,
  detail,
}: {
  score: number;
  caption: string;
  /** Accessible name for the bar. */
  label: string;
  detail?: string;
}) {
  const meta = SCORE_BAND_META[scoreBandOf(score)];

  return (
    <div className="min-w-0">
      <p className="text-[11px] text-fg-subtle">{caption}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className="tabular text-[22px] leading-none font-semibold text-fg">
          {score}
        </span>
        <span className="text-[11.5px] text-fg-subtle">/ 100</span>
      </p>
      <Meter className="mt-2" value={score} tone={meta.meter} label={label} />
      {detail && (
        <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">{detail}</p>
      )}
    </div>
  );
}

/** A page URL, or a clear statement that the piece is not live. */
export function PageUrl({
  url,
  stage,
  className,
}: {
  url: string | null;
  stage?: ContentStage;
  className?: string;
}) {
  if (url === null) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11.5px] whitespace-nowrap text-warning",
          className,
        )}
      >
        <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
        {stage ? `${STAGE_META[stage].label} — not live` : "Not published"}
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

/** Word count with reading time behind it. */
export function WordCount({ record }: { record: ContentRecord }) {
  if (record.url === null) {
    return <span className="text-fg-subtle">—</span>;
  }

  return (
    <span
      className="tabular text-fg-muted"
      title={`About a ${record.readingTime}-minute read`}
    >
      {formatCompact(record.wordCount)}
    </span>
  );
}

/** Inbound and outbound internal links, with an orphan warning. */
export function LinkCounts({ record }: { record: ContentRecord }) {
  if (record.url === null) {
    return <span className="text-fg-subtle">—</span>;
  }

  const orphan = record.internalLinksIn === 0;

  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1.5",
        orphan ? "text-critical" : "text-fg-muted",
      )}
      title={`${record.internalLinksIn} links in, ${record.internalLinksOut} out`}
    >
      {orphan && <Icon name="link-off" className="h-3.5 w-3.5 shrink-0" />}
      {record.internalLinksIn}
      <span className="text-fg-subtle">/</span>
      {record.internalLinksOut}
    </span>
  );
}

/** How long since a page was last touched. */
export function Freshness({ ageDays }: { ageDays: number | null }) {
  if (ageDays === null) {
    return <span className="text-fg-subtle">—</span>;
  }

  const months = Math.round(ageDays / 30);

  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        ageDays > 540
          ? "text-critical"
          : ageDays > 365
            ? "text-warning"
            : "text-fg-muted",
      )}
      title={`Last updated ${formatNumber(ageDays)} days ago`}
    >
      {ageDays < 60 ? `${ageDays}d` : `${months}mo`}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Score breakdown
// ---------------------------------------------------------------------------

/**
 * The content score, taken apart.
 *
 * Published with its weights so the number can be argued with. It is a
 * weighted sum over the mock dataset — arithmetic, not a model — and the
 * footnote on the panel says exactly that rather than implying more.
 */
export function ScoreBreakdown({ score }: { score: ContentScore }) {
  return (
    <ul className="space-y-2.5">
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

/** One line describing a piece, for dense lists and dialogs. */
export function ContentSummaryLine({ record }: { record: ContentRecord }) {
  return (
    <span className="text-[11.5px] text-fg-subtle">
      {record.projectName} · {record.clusterName} ·{" "}
      {FORMAT_META[record.format].label} ·{" "}
      {record.keywordCount === 0
        ? "no keyword mapped"
        : `${record.keywordCount} keyword${record.keywordCount === 1 ? "" : "s"}`}
    </span>
  );
}
