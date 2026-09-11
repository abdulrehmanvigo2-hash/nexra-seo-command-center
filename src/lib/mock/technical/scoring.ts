import { clamp, round } from "@/lib/mock/dashboard/core";
import type {
  CwvState,
  EffortLevel,
  TechnicalFactor,
  TechnicalProvenance,
  TechnicalScore,
  TechnicalSeverity,
} from "@/types/technical";

/**
 * Every formula and every threshold in Technical SEO.
 *
 * One file, deliberately. A threshold written inside a component is a
 * threshold that gets copied the second time it is needed and then drifts,
 * which is how a module ends up calling a page critical on a card and healthy
 * in the table underneath it. Nothing outside this file decides what counts as
 * a deep page, a poor vital, a short title, or a critical finding.
 *
 * Every score is published with its factors, their weights, and what each one
 * contributed, so a number can be argued with rather than taken on trust.
 * They are weighted sums over fixture data — arithmetic, not models — and the
 * UI says so wherever a score appears.
 *
 * Arithmetic stays in the four operations and integer-safe ramps. The product
 * renders on the server and hydrates in the browser, and a score that rounded
 * differently in the two would be a hydration mismatch.
 */

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Core Web Vitals bands.
 *
 * The published field thresholds: LCP in milliseconds, INP in milliseconds,
 * CLS unitless. `good` is the ceiling of the good band, `poor` the floor of
 * the poor band; between them is "needs improvement".
 */
export const CWV_THRESHOLDS = {
  lcp: { good: 2_500, poor: 4_000 },
  inp: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
} as const;

/** Clicks from the home page beyond which a page is treated as buried. */
export const DEPTH_LIMIT = 4;

/** Title tag length, in characters. */
export const TITLE_LENGTH = { min: 30, max: 60 } as const;

/** Meta description length, in characters. */
export const META_LENGTH = { min: 70, max: 160 } as const;

/** Internal links into a page below which it is under-supported. */
export const MIN_INTERNAL_LINKS_IN = 3;

/** Redirect hops beyond which the chain is a finding in itself. */
export const MAX_REDIRECT_HOPS = 1;

/** Severity bands, read off a 0-100 score where 100 is perfect. */
export const SEVERITY_FLOORS: Readonly<Record<TechnicalSeverity, number>> = {
  healthy: 85,
  low: 70,
  medium: 52,
  high: 34,
  critical: 0,
};

/** Worst-first, which is the order every list in this module reads in. */
export const SEVERITY_ORDER: readonly TechnicalSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "healthy",
];

/** Rank of a severity, for sorting and for "the worst of these". */
export const SEVERITY_RANK: Readonly<Record<TechnicalSeverity, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  healthy: 0,
};

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/** The band a 0-100 technical score sits in. */
export function severityFor(score: number): TechnicalSeverity {
  if (score >= SEVERITY_FLOORS.healthy) return "healthy";
  if (score >= SEVERITY_FLOORS.low) return "low";
  if (score >= SEVERITY_FLOORS.medium) return "medium";
  if (score >= SEVERITY_FLOORS.high) return "high";
  return "critical";
}

/** The worse of two severities. */
export function worstSeverity(
  a: TechnicalSeverity,
  b: TechnicalSeverity,
): TechnicalSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * The Core Web Vitals verdict.
 *
 * A page passes only when all three metrics pass, and fails outright when any
 * one of them is in the poor band — which is how the assessment is defined,
 * and not an average the module invented.
 */
export function cwvStateFor(lcp: number, inp: number, cls: number): CwvState {
  if (
    lcp >= CWV_THRESHOLDS.lcp.poor ||
    inp >= CWV_THRESHOLDS.inp.poor ||
    cls >= CWV_THRESHOLDS.cls.poor
  ) {
    return "poor";
  }
  if (
    lcp <= CWV_THRESHOLDS.lcp.good &&
    inp <= CWV_THRESHOLDS.inp.good &&
    cls <= CWV_THRESHOLDS.cls.good
  ) {
    return "good";
  }
  return "needs-improvement";
}

// ---------------------------------------------------------------------------
// Normalising ramps
// ---------------------------------------------------------------------------

/**
 * One vital as a 0-100 reading.
 *
 * Linear inside the good band, linear across the middle band, then decaying
 * below it — so a page that is merely slow and a page that is unusable do not
 * read the same.
 */
function vitalScore(value: number, good: number, poor: number): number {
  if (value <= good) return round(100 - (value / good) * 15, 1);
  if (value >= poor) {
    const overrun = (value - poor) / poor;
    return round(clamp(40 - overrun * 40, 0, 40), 1);
  }
  return round(85 - ((value - good) / (poor - good)) * 45, 1);
}

/** The three vitals as one 0-100 reading. LCP carries the most weight. */
export function vitalsScore(lcp: number, inp: number, cls: number): number {
  return Math.round(
    clamp(
      vitalScore(lcp, CWV_THRESHOLDS.lcp.good, CWV_THRESHOLDS.lcp.poor) * 0.45 +
        vitalScore(inp, CWV_THRESHOLDS.inp.good, CWV_THRESHOLDS.inp.poor) *
          0.3 +
        vitalScore(cls, CWV_THRESHOLDS.cls.good, CWV_THRESHOLDS.cls.poor) * 0.25,
      0,
      100,
    ),
  );
}

/** Crawl depth as a 0-100 reading. Flat until the limit, then falls away. */
export function depthScore(depth: number): number {
  if (depth <= 2) return 100;
  if (depth <= DEPTH_LIMIT) return round(100 - (depth - 2) * 10, 1);
  return round(clamp(80 - (depth - DEPTH_LIMIT) * 18, 0, 80), 1);
}

/** Internal links in, as a 0-100 reading. Saturates at twelve. */
export function linkScore(linksIn: number): number {
  if (linksIn >= 12) return 100;
  if (linksIn >= MIN_INTERNAL_LINKS_IN) {
    return round(60 + ((linksIn - MIN_INTERNAL_LINKS_IN) / 9) * 40, 1);
  }
  return round((linksIn / MIN_INTERNAL_LINKS_IN) * 60, 1);
}

/** A count against a total, as a 0-100 share. */
export function shareOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return round(clamp((part / total) * 100, 0, 100), 1);
}

// ---------------------------------------------------------------------------
// Score assembly
// ---------------------------------------------------------------------------

type FactorInput = {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly weight: number;
  readonly provenance: TechnicalProvenance;
  readonly detail: string;
};

/**
 * Turns weighted readings into a published score.
 *
 * The weights are asserted to sum to 1 by construction at each call site: a
 * factor added without adjusting the others would quietly change every score
 * in the module, so each caller lists them together as one literal.
 */
export function assemble(
  factors: readonly FactorInput[],
  summary: (score: number, severity: TechnicalSeverity) => string,
): TechnicalScore {
  const resolved: TechnicalFactor[] = factors.map((factor) => {
    const value = round(clamp(factor.value, 0, 100), 1);
    return {
      id: factor.id,
      label: factor.label,
      value,
      weight: factor.weight,
      contribution: round(value * factor.weight, 1),
      provenance: factor.provenance,
      detail: factor.detail,
    };
  });

  const score = Math.round(
    clamp(
      resolved.reduce((carry, factor) => carry + factor.value * factor.weight, 0),
      0,
      100,
    ),
  );
  const severity = severityFor(score);

  return { score, severity, factors: resolved, summary: summary(score, severity) };
}

// ---------------------------------------------------------------------------
// Page score
// ---------------------------------------------------------------------------

export type PageScoreInput = {
  readonly fetchable: number;
  readonly indexable: number;
  readonly metadata: number;
  readonly depth: number;
  readonly linksIn: number;
  readonly vitals: number;
  readonly schema: number;
};

/**
 * The technical score for one page.
 *
 * Whether a crawler can fetch it and whether it is allowed to be indexed carry
 * half the score between them, because everything else is moot when either
 * fails. Presentation, structure, speed, and markup divide the rest.
 */
export function pageScore(input: PageScoreInput): TechnicalScore {
  return assemble(
    [
      {
        id: "fetch",
        label: "Fetchable",
        value: input.fetchable,
        weight: 0.26,
        provenance: "seeded",
        detail:
          input.fetchable >= 100
            ? "Responds 200 on the first request, with no redirect in the way."
            : "The response itself is a problem — a crawler never reaches the content.",
      },
      {
        id: "indexable",
        label: "Indexable",
        value: input.indexable,
        weight: 0.24,
        provenance: "derived",
        detail:
          input.indexable >= 100
            ? "Open to indexing and canonical to itself."
            : "Robots or the canonical tag rules this URL out of the index.",
      },
      {
        id: "metadata",
        label: "Metadata",
        value: input.metadata,
        weight: 0.14,
        provenance: "measured",
        detail: `Title, meta description, and H1 checked against ${TITLE_LENGTH.min}-${TITLE_LENGTH.max} and ${META_LENGTH.min}-${META_LENGTH.max} characters.`,
      },
      {
        id: "depth",
        label: "Crawl depth",
        value: input.depth,
        weight: 0.1,
        provenance: "derived",
        detail: `Clicks from the home page, against a limit of ${DEPTH_LIMIT}.`,
      },
      {
        id: "links",
        label: "Internal links in",
        value: input.linksIn,
        weight: 0.1,
        provenance: "measured",
        detail: `Links from other pages of ours, against a floor of ${MIN_INTERNAL_LINKS_IN}.`,
      },
      {
        id: "vitals",
        label: "Core Web Vitals",
        value: input.vitals,
        weight: 0.1,
        provenance: "seeded",
        detail: "Modelled field vitals — LCP, INP, and CLS weighted 45/30/25.",
      },
      {
        id: "schema",
        label: "Structured data",
        value: input.schema,
        weight: 0.06,
        provenance: "derived",
        detail: "Markup completeness for what this page format calls for.",
      },
    ],
    (score, severity) =>
      severity === "healthy"
        ? `Nothing blocking at ${score} out of 100.`
        : severity === "critical"
          ? `${score} out of 100 — this URL is not working for search at all.`
          : `${score} out of 100, held down by the lowest factors above.`,
  );
}

// ---------------------------------------------------------------------------
// Aggregate scores
// ---------------------------------------------------------------------------

export type CrawlScoreInput = {
  readonly total: number;
  readonly crawlable: number;
  readonly broken: number;
  readonly orphans: number;
  readonly deep: number;
  readonly inSitemap: number;
};

/** Can the site be crawled, as a 0-100 reading. */
export function crawlabilityScore(input: CrawlScoreInput): TechnicalScore {
  const { total } = input;

  return assemble(
    [
      {
        id: "reachable",
        label: "Fetchable pages",
        value: shareOf(input.crawlable, total),
        weight: 0.4,
        provenance: "derived",
        detail: `${input.crawlable} of ${total} URLs return content a crawler can read.`,
      },
      {
        id: "unbroken",
        label: "No broken responses",
        value: 100 - shareOf(input.broken, total),
        weight: 0.2,
        provenance: "seeded",
        detail: `${input.broken} URLs answer with an error status.`,
      },
      {
        id: "linked",
        label: "Linked from the site",
        value: 100 - shareOf(input.orphans, total),
        weight: 0.2,
        provenance: "derived",
        detail: `${input.orphans} pages have no internal link pointing at them.`,
      },
      {
        id: "shallow",
        label: "Within crawl depth",
        value: 100 - shareOf(input.deep, total),
        weight: 0.1,
        provenance: "derived",
        detail: `${input.deep} pages sit more than ${DEPTH_LIMIT} clicks from the home page.`,
      },
      {
        id: "sitemap",
        label: "In the sitemap",
        value: shareOf(input.inSitemap, total),
        weight: 0.1,
        provenance: "derived",
        detail: `${input.inSitemap} of ${total} URLs are submitted.`,
      },
    ],
    (score, severity) =>
      severity === "healthy"
        ? `Crawling is not the constraint here — ${score} out of 100.`
        : `${score} out of 100: fix what a crawler cannot reach before anything else.`,
  );
}

export type IndexationScoreInput = {
  readonly total: number;
  readonly indexable: number;
  readonly indexed: number;
  readonly mismatches: number;
  readonly conflicts: number;
};

/** Is what should be indexed actually indexed, as a 0-100 reading. */
export function indexationScore(input: IndexationScoreInput): TechnicalScore {
  const { total, indexable } = input;

  return assemble(
    [
      {
        id: "coverage",
        label: "Indexable pages indexed",
        value: shareOf(input.indexed, Math.max(indexable, 1)),
        weight: 0.45,
        provenance: "seeded",
        detail: `${input.indexed} of ${indexable} indexable URLs are in the index.`,
      },
      {
        id: "eligible",
        label: "Eligible for the index",
        value: shareOf(indexable, total),
        weight: 0.25,
        provenance: "derived",
        detail: `${indexable} of ${total} URLs are allowed to be indexed at all.`,
      },
      {
        id: "submitted",
        label: "Submitted and indexed",
        value: 100 - shareOf(input.mismatches, Math.max(indexable, 1)),
        weight: 0.2,
        provenance: "derived",
        detail: `${input.mismatches} URLs are in the sitemap but not in the index.`,
      },
      {
        id: "consistent",
        label: "No contradictions",
        value: 100 - shareOf(input.conflicts, total),
        weight: 0.1,
        provenance: "derived",
        detail: `${input.conflicts} URLs are indexed while asking not to be.`,
      },
    ],
    (score, severity) =>
      severity === "healthy"
        ? `Coverage is holding at ${score} out of 100.`
        : `${score} out of 100: pages we want found are not being kept.`,
  );
}

export type HealthScoreInput = {
  readonly crawl: number;
  readonly indexation: number;
  readonly vitals: number;
  readonly schema: number;
  readonly metadata: number;
  readonly links: number;
  readonly criticalIssues: number;
  readonly pages: number;
};

/**
 * The site's technical health.
 *
 * Crawl and indexation dominate for the same reason they dominate the page
 * score: a page that cannot be fetched or is not allowed in the index has no
 * metadata problem worth discussing.
 */
export function technicalHealthScore(input: HealthScoreInput): TechnicalScore {
  return assemble(
    [
      {
        id: "crawl",
        label: "Crawlability",
        value: input.crawl,
        weight: 0.28,
        provenance: "derived",
        detail: "Whether a crawler can reach and fetch what we publish.",
      },
      {
        id: "indexation",
        label: "Indexation",
        value: input.indexation,
        weight: 0.26,
        provenance: "derived",
        detail: "Whether what should be in the index is in the index.",
      },
      {
        id: "metadata",
        label: "Metadata",
        value: input.metadata,
        weight: 0.14,
        provenance: "measured",
        detail: "Titles, descriptions, and headings across the inventory.",
      },
      {
        id: "vitals",
        label: "Core Web Vitals",
        value: input.vitals,
        weight: 0.14,
        provenance: "seeded",
        detail: "Modelled field vitals across the inventory.",
      },
      {
        id: "links",
        label: "Internal linking",
        value: input.links,
        weight: 0.1,
        provenance: "measured",
        detail: "How well the site supports its own pages.",
      },
      {
        id: "schema",
        label: "Structured data",
        value: input.schema,
        weight: 0.08,
        provenance: "derived",
        detail: "Markup coverage across the inventory.",
      },
    ],
    (score, severity) =>
      severity === "healthy"
        ? `${score} out of 100 across ${input.pages} URLs, with ${input.criticalIssues} critical findings open.`
        : `${score} out of 100 across ${input.pages} URLs — ${input.criticalIssues} critical findings are holding it down.`,
  );
}

// ---------------------------------------------------------------------------
// Issue priority
// ---------------------------------------------------------------------------

/** How much a severity band contributes to an issue's priority. */
const SEVERITY_WEIGHT: Readonly<Record<TechnicalSeverity, number>> = {
  critical: 100,
  high: 78,
  medium: 54,
  low: 30,
  healthy: 0,
};

/**
 * What to do first, 0-100.
 *
 * Severity carries most of it, but reach matters: one broken page and a
 * hundred missing meta descriptions are not the same job, and an ordering that
 * ignored how many pages a finding touches would bury the second behind the
 * first forever.
 */
export function issuePriority(
  severity: TechnicalSeverity,
  affectedPages: number,
  projectPages: number,
): number {
  const reach = shareOf(affectedPages, Math.max(projectPages, 1));
  // Reach is compressed: the jump from 1 page to 10 should matter more than
  // the jump from 40 to 50, or every sitewide nit outranks every outage.
  const reachScore = reach >= 50 ? 100 : reach >= 20 ? 70 + reach : reach * 3.5;

  return Math.round(
    clamp(SEVERITY_WEIGHT[severity] * 0.72 + reachScore * 0.28, 0, 100),
  );
}


// ---------------------------------------------------------------------------
// Opportunity ranking
// ---------------------------------------------------------------------------

/**
 * How much of a job each effort band represents.
 *
 * Used as a divisor, not a subtraction: a cheap fix with modest value should
 * still be able to outrank an expensive one with slightly more value, which is
 * what a ratio gives and a penalty does not.
 */
export const EFFORT_WEIGHT: Readonly<Record<EffortLevel, number>> = {
  low: 1,
  medium: 1.35,
  high: 1.85,
};

export const EFFORT_ORDER: readonly EffortLevel[] = ["low", "medium", "high"];

/**
 * What fixing a finding is worth, 0-100.
 *
 * Severity says how bad one instance is; reach says how much of the site it
 * touches. Both matter, and the same compression used for issue priority
 * applies here so that one outage does not sit below a hundred tidy-ups.
 */
export function opportunityImpact(
  severity: TechnicalSeverity,
  affectedPages: number,
  projectPages: number,
): number {
  return issuePriority(severity, affectedPages, projectPages);
}

/**
 * Where a job belongs in the queue, 0-100.
 *
 * Value per unit of effort, rescaled back to 0-100 so the number stays
 * readable next to every other score in the module.
 */
export function opportunityPriority(
  impact: number,
  effort: EffortLevel,
): number {
  return Math.round(clamp(impact / EFFORT_WEIGHT[effort], 0, 100));
}

// ---------------------------------------------------------------------------
// Area scores
// ---------------------------------------------------------------------------

export type VitalsScoreInput = {
  readonly measured: number;
  readonly passing: number;
  readonly poor: number;
  readonly unmeasured: number;
  readonly total: number;
  readonly medianScore: number;
};

/** Core Web Vitals across a selection, as a 0-100 reading. */
export function vitalsHealthScore(input: VitalsScoreInput): TechnicalScore {
  return assemble(
    [
      {
        id: "pass-rate",
        label: "Pages passing",
        value: shareOf(input.passing, Math.max(input.measured, 1)),
        weight: 0.45,
        provenance: "derived",
        detail: `${input.passing} of ${input.measured} measured URLs are inside the good band on all three vitals.`,
      },
      {
        id: "not-poor",
        label: "No poor vital",
        value: 100 - shareOf(input.poor, Math.max(input.measured, 1)),
        weight: 0.3,
        provenance: "derived",
        detail: `${input.poor} URLs have at least one vital in the poor band.`,
      },
      {
        id: "median",
        label: "Typical page",
        value: input.medianScore,
        weight: 0.15,
        provenance: "seeded",
        detail: "The median page's combined vitals reading.",
      },
      {
        id: "measured",
        label: "Coverage of the inventory",
        value: shareOf(input.measured, Math.max(input.total, 1)),
        weight: 0.1,
        provenance: "derived",
        detail: `${input.unmeasured} URLs carry too little traffic to model a field reading.`,
      },
    ],
    (score, severity) =>
      severity === "healthy"
        ? `Loading is not the constraint here — ${score} out of 100.`
        : `${score} out of 100: the assessment is easier to hold than to regain.`,
  );
}

export type SchemaScoreInput = {
  readonly total: number;
  readonly complete: number;
  readonly partial: number;
  readonly invalid: number;
  readonly missing: number;
};

/** Structured data across a selection, as a 0-100 reading. */
export function schemaHealthScore(input: SchemaScoreInput): TechnicalScore {
  return assemble(
    [
      {
        id: "complete",
        label: "Complete markup",
        value: shareOf(input.complete, Math.max(input.total, 1)),
        weight: 0.5,
        provenance: "derived",
        detail: `${input.complete} of ${input.total} URLs carry every type their format calls for.`,
      },
      {
        id: "present",
        label: "Any markup at all",
        value: shareOf(
          input.total - input.missing,
          Math.max(input.total, 1),
        ),
        weight: 0.3,
        provenance: "derived",
        detail: `${input.missing} URLs carry no structured data.`,
      },
      {
        id: "valid",
        label: "Valid markup",
        value: 100 - shareOf(input.invalid, Math.max(input.total, 1)),
        weight: 0.2,
        provenance: "seeded",
        detail: `${input.invalid} URLs carry markup that fails validation, so none of it counts.`,
      },
    ],
    (score, severity) =>
      severity === "healthy"
        ? `Markup is in good shape at ${score} out of 100.`
        : `${score} out of 100: the richer result formats are only partly reachable.`,
  );
}

export type LinkScoreInput = {
  readonly total: number;
  readonly orphans: number;
  readonly weak: number;
  readonly deep: number;
  readonly brokenLinks: number;
  readonly deadEnds: number;
  readonly meanLinksIn: number;
};

/** Internal linking across a selection, as a 0-100 reading. */
export function linkHealthScore(input: LinkScoreInput): TechnicalScore {
  return assemble(
    [
      {
        id: "linked",
        label: "Pages linked at all",
        value: 100 - shareOf(input.orphans, Math.max(input.total, 1)),
        weight: 0.3,
        provenance: "derived",
        detail: `${input.orphans} pages have no internal link pointing at them.`,
      },
      {
        id: "supported",
        label: "Adequately supported",
        value: 100 - shareOf(input.weak, Math.max(input.total, 1)),
        weight: 0.25,
        provenance: "derived",
        detail: `${input.weak} pages sit below ${MIN_INTERNAL_LINKS_IN} inbound links.`,
      },
      {
        id: "depth",
        label: "Within crawl depth",
        value: 100 - shareOf(input.deep, Math.max(input.total, 1)),
        weight: 0.15,
        provenance: "derived",
        detail: `${input.deep} pages sit more than ${DEPTH_LIMIT} clicks from the home page.`,
      },
      {
        id: "unbroken",
        label: "Links that resolve",
        value: 100 - shareOf(input.brokenLinks, Math.max(input.total, 1)),
        weight: 0.2,
        provenance: "derived",
        detail: `${input.brokenLinks} pages link to a URL that does not serve.`,
      },
      {
        id: "flow",
        label: "Authority flows on",
        value: 100 - shareOf(input.deadEnds, Math.max(input.total, 1)),
        weight: 0.1,
        provenance: "measured",
        detail: `${input.deadEnds} pages link to nothing else on the site.`,
      },
    ],
    (score, severity) =>
      severity === "healthy"
        ? `The site supports its own pages well — ${score} out of 100.`
        : `${score} out of 100, averaging ${input.meanLinksIn} inbound links a page.`,
  );
}

/**
 * How well the site supports one page, 0-100.
 *
 * Inbound links carry it, with depth and what the page links out to adjusting
 * the reading: a page three clicks deep with eight links in is better placed
 * than one at the same depth with one.
 */
export function supportScore(
  linksIn: number,
  depth: number,
  deadEnd: boolean,
): number {
  return Math.round(
    clamp(
      linkScore(linksIn) * 0.62 + depthScore(depth) * 0.3 + (deadEnd ? 0 : 8),
      0,
      100,
    ),
  );
}
