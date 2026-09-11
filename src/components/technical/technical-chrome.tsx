import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import {
  CANONICAL_META,
  CATEGORY_META,
  CRAWL_STATE_META,
  CWV_META,
  INDEXABILITY_META,
  INDEX_STATUS_META,
  ISSUE_STATUS_META,
  PROVENANCE_META,
  SCHEMA_META,
  SEVERITY_META,
} from "@/lib/mock/technical";
import type {
  CanonicalState,
  CrawlState,
  CwvState,
  DistributionRow,
  IndexStatus,
  Indexability,
  IssueCategory,
  IssueStatus,
  SchemaState,
  TechnicalProvenance,
  TechnicalScore,
  TechnicalSeverity,
} from "@/types/technical";

/**
 * The pieces of technical display that appear in more than one place.
 *
 * A severity, a crawl state, an index status, a response code, and a published
 * score read the same on the overview, in a table row, and on a card because
 * all of them render these components. A component that writes its own label
 * is a component that disagrees with the next one.
 */

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function SeverityBadge({
  severity,
  count,
}: {
  severity: TechnicalSeverity;
  /** Shown after the label where the number adds something. */
  count?: number;
}) {
  const meta = SEVERITY_META[severity];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
      {count !== undefined && (
        <span className="tabular font-normal opacity-80">{count}</span>
      )}
    </Badge>
  );
}

export function CrawlStateBadge({ state }: { state: CrawlState }) {
  const meta = CRAWL_STATE_META[state];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function IndexStatusBadge({ status }: { status: IndexStatus }) {
  const meta = INDEX_STATUS_META[status];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function IndexabilityBadge({ value }: { value: Indexability }) {
  const meta = INDEXABILITY_META[value];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function CanonicalBadge({ state }: { state: CanonicalState }) {
  const meta = CANONICAL_META[state];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function CwvBadge({ state }: { state: CwvState }) {
  const meta = CWV_META[state];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function SchemaBadge({ state }: { state: SchemaState }) {
  const meta = SCHEMA_META[state];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function CategoryBadge({ category }: { category: IssueCategory }) {
  const meta = CATEGORY_META[category];
  return (
    <Badge tone="neutral" title={meta.description}>
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const meta = ISSUE_STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
    </Badge>
  );
}

/**
 * Where a figure came from.
 *
 * Shown next to anything this product did not measure, so a modelled reading
 * is never mistaken for one a crawler or a search console reported.
 */
export function ProvenanceTag({
  provenance,
  className,
}: {
  provenance: TechnicalProvenance;
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

/** An HTTP response code, coloured by what it means rather than by its range. */
export function StatusCode({ status }: { status: number }) {
  const tone =
    status >= 500
      ? "text-critical"
      : status === 404 || status === 410
        ? "text-critical"
        : status >= 300
          ? "text-warning"
          : "text-positive";

  return (
    <span className={cn("tabular font-semibold", tone)}>{status}</span>
  );
}

/** Clicks from the home page, flagged when past the limit. */
export function DepthValue({
  depth,
  limit,
}: {
  depth: number;
  limit: number;
}) {
  const deep = depth > limit;
  return (
    <span
      className={cn("tabular", deep ? "font-semibold text-warning" : "text-fg-muted")}
      title={
        deep
          ? `${depth} clicks from the home page — past the ${limit}-click limit`
          : `${depth} clicks from the home page`
      }
    >
      {depth}
    </span>
  );
}

/** Internal links into a page, flagged when the page is unsupported. */
export function LinksInValue({
  links,
  floor,
}: {
  links: number;
  floor: number;
}) {
  if (links === 0) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-warning">
        <Icon name="link-off" className="h-3.5 w-3.5 shrink-0" />
        <span className="tabular font-semibold">0</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "tabular",
        links < floor ? "font-semibold text-warning" : "text-fg-muted",
      )}
      title={`${links} internal links point at this page`}
    >
      {links}
    </span>
  );
}

/** A 0-100 score with its bar, for dense table rows. */
export function ScoreValue({
  score,
  label,
  tone = "accent",
}: {
  score: number;
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

/** The tone a 0-100 technical score should be drawn in. */
export function toneForScore(
  score: number,
): "positive" | "accent" | "warning" | "critical" {
  if (score >= 85) return "positive";
  if (score >= 70) return "accent";
  if (score >= 52) return "warning";
  return "critical";
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

/** A URL, linked to the content record behind it. */
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

const BAR_TONE: Record<DistributionRow["tone"], string> = {
  positive: "bg-positive",
  accent: "bg-accent",
  warning: "bg-warning",
  critical: "bg-critical",
  neutral: "bg-fg-subtle",
};

/** A labelled distribution: count, share, and a proportional bar. */
export function DistributionList({
  rows,
  emptyLabel = "Nothing to show for this selection.",
}: {
  rows: readonly DistributionRow[];
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
            aria-label={`${row.label}: ${row.count} pages, ${row.share}%`}
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
 * Every score in this module ships with its factors, their weights, and what
 * each contributed, so a number can be argued with instead of taken on trust.
 * The provenance tag on each row says whether the reading was measured,
 * derived, or modelled.
 */
export function ScoreBreakdownList({ score }: { score: TechnicalScore }) {
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
