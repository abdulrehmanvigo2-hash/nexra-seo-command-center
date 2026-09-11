import { clamp, round } from "@/lib/mock/dashboard/core";
import type {
  AnchorKind,
  AuthorityFactor,
  AuthorityScore,
  LinkProvenance,
  LinkQualityBand,
  LinkRel,
  LinkSeverity,
  OutreachEffort,
  RelevanceBand,
} from "@/types/backlinks";

/**
 * Every formula and every threshold in Backlinks & Authority.
 *
 * One file, deliberately — the same discipline Technical SEO and AI Visibility
 * keep. A threshold written inside a component is one that gets copied the
 * second time it is needed and then drifts, which is how a module ends up
 * calling a link harmful on a card and average in the table beneath it.
 *
 * Every score is published with its factors, their weights and what each one
 * contributed, so the number can be argued with rather than taken on trust.
 * They are weighted sums over fixture data — arithmetic, not models — and no
 * link-data provider is consulted anywhere.
 *
 * Arithmetic stays in the four operations and integer-safe ramps: the product
 * renders on the server and hydrates in the browser, and a score that rounded
 * differently in the two would be a hydration mismatch.
 */

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/** Lowest score that still reads as each quality band. */
export const QUALITY_FLOORS: Readonly<Record<LinkQualityBand, number>> = {
  excellent: 78,
  strong: 62,
  average: 42,
  weak: 22,
  harmful: 0,
};

export const QUALITY_ORDER: readonly LinkQualityBand[] = [
  "excellent",
  "strong",
  "average",
  "weak",
  "harmful",
];

/**
 * The band a 0-100 link quality score sits in.
 *
 * `harmful` is not simply "the lowest scores" — a link can score poorly and
 * still be harmless. The toxicity check below is what moves a link into that
 * band, so `qualityBandFor` takes the risk reading as well as the score.
 */
export function qualityBandFor(score: number, toxicScore: number): LinkQualityBand {
  if (toxicScore >= TOXIC_HARMFUL) return "harmful";
  if (score >= QUALITY_FLOORS.excellent) return "excellent";
  if (score >= QUALITY_FLOORS.strong) return "strong";
  if (score >= QUALITY_FLOORS.average) return "average";
  return "weak";
}

export const SEVERITY_ORDER: readonly LinkSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
];

export const SEVERITY_RANK: Readonly<Record<LinkSeverity, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Relevance bands, read off a 0-100 topical match. */
export const RELEVANCE_FLOORS: Readonly<Record<RelevanceBand, number>> = {
  direct: 72,
  adjacent: 48,
  peripheral: 25,
  unrelated: 0,
};

export const RELEVANCE_ORDER: readonly RelevanceBand[] = [
  "direct",
  "adjacent",
  "peripheral",
  "unrelated",
];

export function relevanceBandFor(relevance: number): RelevanceBand {
  if (relevance >= RELEVANCE_FLOORS.direct) return "direct";
  if (relevance >= RELEVANCE_FLOORS.adjacent) return "adjacent";
  if (relevance >= RELEVANCE_FLOORS.peripheral) return "peripheral";
  return "unrelated";
}

// ---------------------------------------------------------------------------
// Toxicity
// ---------------------------------------------------------------------------

/** At or above this risk score, a link is treated as harmful. */
export const TOXIC_HARMFUL = 62;

/** At or above this, a link is worth a human review. */
export const TOXIC_REVIEW = 34;

/** What each risk signal contributes to a link's toxicity score. */
export const TOXIC_WEIGHT: Readonly<Record<string, number>> = {
  "link-farm": 66,
  "paid-undisclosed": 58,
  "expired-domain": 30,
  "foreign-language-spam": 28,
  "anchor-over-optimised": 24,
  "sitewide-footer": 20,
  "low-quality-directory": 18,
  "irrelevant-topic": 14,
};

/**
 * How risky a link is, 0-100.
 *
 * Signals accumulate rather than taking the maximum: three moderate problems
 * on one link is a worse profile than one moderate problem, and a scoring rule
 * that only reported the worst would hide that.
 */
export function toxicScoreFor(signals: readonly string[]): number {
  const total = signals.reduce(
    (carry, signal) => carry + (TOXIC_WEIGHT[signal] ?? 0),
    0,
  );
  return Math.round(clamp(total, 0, 100));
}

// ---------------------------------------------------------------------------
// Anchor ceilings
// ---------------------------------------------------------------------------

/**
 * The healthy ceiling for each anchor kind, as a share of followed links.
 *
 * A natural profile is mostly branded and page-title anchors with a long tail
 * of generic and naked URLs. Exact-match anchors are the ones that look bought
 * in volume, so their ceiling is the lowest — and going past it is what the
 * anchor check reports, not the individual anchors themselves.
 */
export const ANCHOR_CEILING: Readonly<Record<AnchorKind, number>> = {
  "exact-match": 12,
  "partial-match": 22,
  branded: 100,
  "naked-url": 30,
  generic: 30,
  image: 15,
  "page-title": 45,
};

/** How natural an anchor profile reads, 0-100. */
export function anchorHealthScore(
  shares: Readonly<Record<AnchorKind, number>>,
): number {
  // Every point past a ceiling costs twice what it would inside it: an anchor
  // profile is judged on its excesses, not on its averages.
  const penalty = (Object.keys(ANCHOR_CEILING) as AnchorKind[]).reduce(
    (carry, kind) =>
      carry + Math.max(0, (shares[kind] ?? 0) - ANCHOR_CEILING[kind]) * 2,
    0,
  );

  // A profile with almost no branded anchors reads as manufactured even when
  // nothing is individually over its ceiling.
  const brandedShortfall = Math.max(0, 25 - (shares.branded ?? 0));

  return Math.round(clamp(100 - penalty - brandedShortfall * 0.8, 0, 100));
}

// ---------------------------------------------------------------------------
// Normalising ramps
// ---------------------------------------------------------------------------

/** A count against a total, as a 0-100 share. */
export function ratio(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return round(clamp((part / whole) * 100, 0, 100), 1);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return round(
    values.reduce((carry, value) => carry + value, 0) / values.length,
    1,
  );
}

/**
 * Referring-domain count as a 0-100 reading.
 *
 * Flattens hard: the difference between 20 and 60 referring domains matters
 * far more than the difference between 400 and 440, and a linear ramp would
 * say the opposite.
 */
export function domainCountScore(domains: number): number {
  if (domains >= 400) return 100;
  if (domains >= 150) return round(80 + ((domains - 150) / 250) * 20, 1);
  if (domains >= 50) return round(55 + ((domains - 50) / 100) * 25, 1);
  if (domains >= 10) return round(22 + ((domains - 10) / 40) * 33, 1);
  return round((domains / 10) * 22, 1);
}

/**
 * How much a link's `rel` lets it carry.
 *
 * Nofollow is not worthless — it still carries referral traffic and brand
 * signal — so it scores low rather than zero, and sponsored lowest of the
 * three because it says outright that the link was bought.
 */
export const REL_VALUE: Readonly<Record<LinkRel, number>> = {
  follow: 100,
  ugc: 32,
  nofollow: 28,
  sponsored: 14,
};

/** Outbound-link dilution: a page linking to everyone passes little to anyone. */
export function dilutionScore(outboundDomains: number): number {
  if (outboundDomains <= 20) return 100;
  if (outboundDomains <= 100) return round(100 - ((outboundDomains - 20) / 80) * 35, 1);
  if (outboundDomains <= 500) return round(65 - ((outboundDomains - 100) / 400) * 40, 1);
  return round(clamp(25 - (outboundDomains - 500) / 200, 5, 25), 1);
}

// ---------------------------------------------------------------------------
// Score assembly
// ---------------------------------------------------------------------------

type FactorInput = {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly weight: number;
  readonly provenance: LinkProvenance;
  readonly detail: string;
};

/**
 * Turns weighted readings into a published score.
 *
 * Weights sum to 1 by construction at each call site: a factor added without
 * adjusting the others would quietly change every score in the module, so each
 * caller lists them together as one literal.
 */
export function assemble(
  factors: readonly FactorInput[],
  toxicScore: number,
  summary: (score: number, band: LinkQualityBand) => string,
): AuthorityScore {
  const resolved: AuthorityFactor[] = factors.map((factor) => {
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
  const band = qualityBandFor(score, toxicScore);

  return { score, band, factors: resolved, summary: summary(score, band) };
}

// ---------------------------------------------------------------------------
// Link quality
// ---------------------------------------------------------------------------

export type LinkQualityInput = {
  readonly authority: number;
  readonly relevance: number;
  readonly rel: LinkRel;
  readonly placement: number;
  readonly outboundDomains: number;
  readonly toxicScore: number;
};

/**
 * What one link is worth, 0-100.
 *
 * Authority leads, but relevance is close behind it deliberately: a link from
 * a strong site about nothing to do with us is worth less than a link from a
 * moderate site squarely on our subject, and a model weighted only on
 * authority would recommend chasing the wrong things.
 */
export function linkQuality(input: LinkQualityInput): AuthorityScore {
  return assemble(
    [
      {
        id: "authority",
        label: "Domain authority",
        value: input.authority,
        weight: 0.32,
        provenance: "modelled",
        detail:
          "Modelled strength of the referring domain. No link-data provider is behind this figure.",
      },
      {
        id: "relevance",
        label: "Topical relevance",
        value: input.relevance,
        weight: 0.28,
        provenance: "modelled",
        detail: "How closely the referring site's subject matches the project's.",
      },
      {
        id: "rel",
        label: "Link attribute",
        value: REL_VALUE[input.rel],
        weight: 0.18,
        provenance: "modelled",
        detail:
          input.rel === "follow"
            ? "A followed link, so it carries ranking signal as well as referral."
            : `Marked ${input.rel}: referral and brand value only.`,
      },
      {
        id: "placement",
        label: "Placement",
        value: input.placement,
        weight: 0.12,
        provenance: "modelled",
        detail: "Where on the page the link sits, and how likely it is to be followed.",
      },
      {
        id: "dilution",
        label: "Outbound dilution",
        value: dilutionScore(input.outboundDomains),
        weight: 0.1,
        provenance: "modelled",
        detail: `The referring domain links out to about ${input.outboundDomains} sites.`,
      },
    ],
    input.toxicScore,
    (score, band) =>
      band === "harmful"
        ? "Carries risk signals that outweigh anything it contributes."
        : band === "excellent"
          ? `${score} out of 100: a link worth protecting.`
          : `${score} out of 100.`,
  );
}

// ---------------------------------------------------------------------------
// Domain quality
// ---------------------------------------------------------------------------

export type DomainQualityInput = {
  readonly authority: number;
  readonly relevance: number;
  readonly traffic: number;
  readonly followedShare: number;
  readonly outboundDomains: number;
  readonly toxicScore: number;
};

/** What a referring domain is worth to us overall, 0-100. */
export function domainQuality(input: DomainQualityInput): AuthorityScore {
  const trafficScore =
    input.traffic >= 250_000
      ? 100
      : input.traffic >= 40_000
        ? round(72 + ((input.traffic - 40_000) / 210_000) * 28, 1)
        : input.traffic >= 5_000
          ? round(40 + ((input.traffic - 5_000) / 35_000) * 32, 1)
          : round((input.traffic / 5_000) * 40, 1);

  return assemble(
    [
      {
        id: "authority",
        label: "Domain authority",
        value: input.authority,
        weight: 0.3,
        provenance: "modelled",
        detail: "Modelled strength of the site.",
      },
      {
        id: "relevance",
        label: "Topical relevance",
        value: input.relevance,
        weight: 0.26,
        provenance: "modelled",
        detail: "How closely its subject matches the project's.",
      },
      {
        id: "traffic",
        label: "Audience",
        value: trafficScore,
        weight: 0.18,
        provenance: "modelled",
        detail: "Modelled monthly traffic to the referring site.",
      },
      {
        id: "followed",
        label: "Links that count",
        value: input.followedShare,
        weight: 0.16,
        provenance: "derived",
        detail: "Share of this domain's links to us that are followed.",
      },
      {
        id: "dilution",
        label: "Outbound dilution",
        value: dilutionScore(input.outboundDomains),
        weight: 0.1,
        provenance: "modelled",
        detail: `Links out to about ${input.outboundDomains} sites.`,
      },
    ],
    input.toxicScore,
    (score, band) =>
      band === "harmful"
        ? "Flagged: the risk signals here outweigh what the domain contributes."
        : `${score} out of 100 across this domain's links to us.`,
  );
}

// ---------------------------------------------------------------------------
// Page authority
// ---------------------------------------------------------------------------

export type PageAuthorityInput = {
  readonly links: number;
  readonly domains: number;
  readonly meanAuthority: number;
  readonly followedShare: number;
  readonly internalLinksIn: number;
};

/**
 * How much link value reaches one of our pages, 0-100.
 *
 * Referring *domains* carry more weight than raw link count, because twenty
 * links from one site is one endorsement repeated, not twenty endorsements.
 */
export function pageAuthority(input: PageAuthorityInput): AuthorityScore {
  return assemble(
    [
      {
        id: "domains",
        label: "Referring domains",
        value: domainCountScore(input.domains * 8),
        weight: 0.36,
        provenance: "derived",
        detail: `${input.domains} distinct sites link to this page.`,
      },
      {
        id: "authority",
        label: "Mean domain authority",
        value: input.meanAuthority,
        weight: 0.3,
        provenance: "modelled",
        detail: "Average modelled strength of the sites linking here.",
      },
      {
        id: "followed",
        label: "Links that count",
        value: input.followedShare,
        weight: 0.18,
        provenance: "derived",
        detail: "Share of the links to this page that are followed.",
      },
      {
        id: "internal",
        label: "Internal support",
        value: Math.min(input.internalLinksIn * 10, 100),
        weight: 0.16,
        provenance: "derived",
        detail: `${input.internalLinksIn} internal links point at this page, from the canonical content layer.`,
      },
    ],
    0,
    (score) => `${score} out of 100 from ${input.links} links across ${input.domains} domains.`,
  );
}

// ---------------------------------------------------------------------------
// Project authority
// ---------------------------------------------------------------------------

export type ProjectAuthorityInput = {
  readonly domains: number;
  readonly meanQuality: number;
  readonly followedShare: number;
  readonly anchorHealth: number;
  readonly toxicShare: number;
  readonly retention: number;
};

/**
 * The project's authority, 0-100.
 *
 * Size and quality carry it between them, with the anchor profile and the
 * toxic share acting as the two things that can pull an otherwise healthy
 * profile down — which is what they do in reality.
 */
export function projectAuthority(input: ProjectAuthorityInput): AuthorityScore {
  return assemble(
    [
      {
        id: "reach",
        label: "Referring domains",
        value: domainCountScore(input.domains),
        weight: 0.3,
        provenance: "derived",
        detail: `${input.domains} distinct sites link to this project.`,
      },
      {
        id: "quality",
        label: "Link quality",
        value: input.meanQuality,
        weight: 0.26,
        provenance: "modelled",
        detail: "Mean quality across the profile's links.",
      },
      {
        id: "followed",
        label: "Links that count",
        value: input.followedShare,
        weight: 0.14,
        provenance: "derived",
        detail: "Share of the profile that is followed.",
      },
      {
        id: "anchors",
        label: "Anchor health",
        value: input.anchorHealth,
        weight: 0.14,
        provenance: "derived",
        detail: "How natural the anchor distribution reads.",
      },
      {
        id: "clean",
        label: "Free of risk signals",
        value: 100 - input.toxicShare,
        weight: 0.1,
        provenance: "modelled",
        detail: `${input.toxicShare}% of the profile carries a risk signal.`,
      },
      {
        id: "retention",
        label: "Link retention",
        value: input.retention,
        weight: 0.06,
        provenance: "derived",
        detail: "Share of links gained in the window that are still live.",
      },
    ],
    0,
    (score, band) =>
      band === "excellent"
        ? `${score} out of 100: a profile worth defending.`
        : `${score} out of 100 across ${input.domains} referring domains.`,
  );
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export type RiskInput = {
  readonly links: number;
  readonly flagged: number;
  readonly disavow: number;
  readonly anchorHealth: number;
};

/** How clean a profile is, 0-100. Higher is safer. */
export function riskScore(input: RiskInput): AuthorityScore {
  return assemble(
    [
      {
        id: "clean-links",
        label: "Links without a signal",
        value: 100 - ratio(input.flagged, Math.max(input.links, 1)),
        weight: 0.46,
        provenance: "modelled",
        detail: `${input.flagged} of ${input.links} links carry a risk signal.`,
      },
      {
        id: "no-disavow",
        label: "Nothing needing disavowal",
        value: 100 - ratio(input.disavow, Math.max(input.links, 1)),
        weight: 0.32,
        provenance: "modelled",
        detail: `${input.disavow} links are bad enough to disavow.`,
      },
      {
        id: "anchors",
        label: "Anchor health",
        value: input.anchorHealth,
        weight: 0.22,
        provenance: "derived",
        detail: "An over-optimised anchor profile is a risk in itself.",
      },
    ],
    0,
    (score) =>
      score >= 80
        ? `${score} out of 100: nothing here needs urgent attention.`
        : `${score} out of 100 — see the flagged links below.`,
  );
}

// ---------------------------------------------------------------------------
// Outreach ranking
// ---------------------------------------------------------------------------

/** How much of a job each effort band represents. Same shape as Phases 8 and 9. */
export const EFFORT_WEIGHT: Readonly<Record<OutreachEffort, number>> = {
  low: 1,
  medium: 1.35,
  high: 1.85,
};

export const EFFORT_ORDER: readonly OutreachEffort[] = ["low", "medium", "high"];

/**
 * What winning a link is worth, 0-100.
 *
 * Authority and relevance again, plus how many rivals already have it: a
 * domain linking to three competitors and not to us is a demonstrated gap, not
 * a speculative one.
 */
export function outreachValue(
  authority: number,
  relevance: number,
  rivalsLinked: number,
): number {
  return Math.round(
    clamp(
      authority * 0.46 + relevance * 0.34 + Math.min(rivalsLinked, 4) * 5,
      0,
      100,
    ),
  );
}

/**
 * How realistic winning it is, 0-100.
 *
 * Inversely related to authority — the strongest sites are the hardest to
 * reach — and helped by the rivals already linked, because a site that links
 * to three competitors has shown it will link to someone in this market.
 */
export function winnabilityScore(
  authority: number,
  rivalsLinked: number,
  relevance: number,
): number {
  return Math.round(
    clamp(
      (100 - authority) * 0.5 + Math.min(rivalsLinked, 4) * 9 + relevance * 0.2,
      4,
      96,
    ),
  );
}

/** Where a job belongs in the queue, 0-100. Value against effort. */
export function outreachPriority(value: number, effort: OutreachEffort): number {
  return Math.round(clamp(value / EFFORT_WEIGHT[effort], 0, 100));
}
