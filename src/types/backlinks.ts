/**
 * Shapes for the Backlinks & Authority module (CLAUDE.md §14, Phase 10).
 *
 * A backlink is the one thing in this product that is genuinely external. No
 * crawler, index, or link-data provider is connected in this milestone
 * (CLAUDE.md §4), so every link, referring domain, and authority figure here
 * is modelled — deterministically, from the project's own seed — and the UI
 * says so wherever a figure appears. No vendor is named anywhere.
 *
 * What is *not* invented is where a link points. Every backlink targets a
 * published page from the canonical content inventory, referenced by id, so
 * the pages earning links here are the same pages Content Studio, Technical
 * SEO, and AI Visibility describe. There is no second page list.
 *
 * Domains are invented for the demo on the reserved `.example` TLD, following
 * the convention Competitor Intelligence already set.
 */
import type { IconName } from "@/components/icons";
import type { BadgeTone } from "@/components/ui/badge";
import type { MetricHealth, MetricTrend } from "@/types/dashboard";
import type { AgentId } from "@/types/keyword";

export type { AgentId, MetricHealth, MetricTrend };

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Where a figure came from.
 *
 * `derived` — arithmetic over canonical records this product owns: which page
 *   a link targets, what that page scores, which project it belongs to.
 * `modelled` — a deterministic stand-in for something only a link-data
 *   provider could report: that a link exists at all, its authority, its
 *   anchor, when it was first seen.
 *
 * There is no `measured` member. Nothing in this module is measured.
 */
export type LinkProvenance = "derived" | "modelled";

// ---------------------------------------------------------------------------
// Link vocabulary
// ---------------------------------------------------------------------------

/** How the link was acquired, as far as the model represents it. */
export type LinkKind =
  | "editorial"
  | "guest-post"
  | "digital-pr"
  | "resource-page"
  | "directory"
  | "unlinked-mention"
  | "broken-link-rebuild"
  | "syndication"
  | "forum"
  | "sponsored";

/** The `rel` attribute the link carries. */
export type LinkRel = "follow" | "nofollow" | "ugc" | "sponsored";

/** Whether the link is live, and how it got that way. */
export type LinkStatus = "live" | "new" | "lost" | "redirected" | "broken";

/** Where the link sits on the referring page. */
export type LinkPlacement = "in-content" | "author-bio" | "footer" | "sidebar" | "list";

/**
 * What the anchor text is doing.
 *
 * The classification matters more than the text: a profile that is 60% exact
 * match reads as manipulated whatever the individual anchors say.
 */
export type AnchorKind =
  | "exact-match"
  | "partial-match"
  | "branded"
  | "naked-url"
  | "generic"
  | "image"
  | "page-title";

/** How much a link is worth having. */
export type LinkQualityBand = "excellent" | "strong" | "average" | "weak" | "harmful";

/** Why a link is flagged as a risk. */
export type ToxicSignal =
  | "link-farm"
  | "irrelevant-topic"
  | "sitewide-footer"
  | "paid-undisclosed"
  | "expired-domain"
  | "anchor-over-optimised"
  | "low-quality-directory"
  | "foreign-language-spam";

/** What to do about a flagged link. */
export type ToxicAction = "monitor" | "review" | "request-removal" | "disavow";

// ---------------------------------------------------------------------------
// Referring domains
// ---------------------------------------------------------------------------

/** What kind of site the link comes from. */
export type DomainCategory =
  | "publisher"
  | "trade-media"
  | "blog"
  | "directory"
  | "education"
  | "government"
  | "association"
  | "vendor"
  | "community"
  | "aggregator";

/** How closely the domain's subject matches ours. */
export type RelevanceBand = "direct" | "adjacent" | "peripheral" | "unrelated";

/** The relationship a referring domain has with us over time. */
export type DomainRelationship = "recurring" | "one-off" | "declining" | "lapsed";

// ---------------------------------------------------------------------------
// Outreach
// ---------------------------------------------------------------------------

/** The kind of work an outreach opportunity represents. */
export type OutreachKind =
  | "digital-pr"
  | "unlinked-mention"
  | "resource-page"
  | "broken-link"
  | "guest-post"
  | "competitor-gap"
  | "reclaim-lost"
  | "internal-authority"
  | "disavow"
  | "relationship-revival";

/** Where an outreach job has got to. Session-only in the UI. */
export type OutreachStage =
  | "identified"
  | "queued"
  | "contacted"
  | "negotiating"
  | "won"
  | "declined";

/** How much work the job is. Same three bands as Technical SEO and AI. */
export type OutreachEffort = "low" | "medium" | "high";

export type LinkSeverity = "critical" | "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// Vocabulary metadata
// ---------------------------------------------------------------------------

export type LinkStateMeta = {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly description: string;
};

export type LinkKindMeta = {
  readonly label: string;
  readonly icon: IconName;
  readonly description: string;
};

export type ToxicSignalMeta = {
  readonly label: string;
  readonly icon: IconName;
  readonly severity: LinkSeverity;
  /** What was found. */
  readonly description: string;
  /** Why it matters. */
  readonly impact: string;
  /** The default handling for a link carrying this signal. */
  readonly action: ToxicAction;
};

export type OutreachKindMeta = {
  readonly label: string;
  readonly icon: IconName;
  readonly description: string;
  readonly effort: OutreachEffort;
  readonly owner: AgentId;
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** One weighted input to an authority score, published with its arithmetic. */
export type AuthorityFactor = {
  readonly id: string;
  readonly label: string;
  /** The factor's own reading, 0-100. */
  readonly value: number;
  /** Share of the score this factor carries. The weights sum to 1. */
  readonly weight: number;
  /** `value × weight`, rounded to one decimal. */
  readonly contribution: number;
  readonly provenance: LinkProvenance;
  readonly detail: string;
};

/** A published 0-100 authority score, taken apart. */
export type AuthorityScore = {
  readonly score: number;
  readonly band: LinkQualityBand;
  readonly factors: readonly AuthorityFactor[];
  readonly summary: string;
};

// ---------------------------------------------------------------------------
// The referring domain record
// ---------------------------------------------------------------------------

/**
 * One site that links to us.
 *
 * The canonical record for this module: a backlink belongs to a referring
 * domain, and a domain's authority, relevance and trust are properties of the
 * site rather than of each link from it. Nothing else re-derives them.
 */
export type ReferringDomain = {
  readonly id: string;
  readonly domain: string;
  readonly name: string;
  readonly category: DomainCategory;

  readonly projectId: string;
  readonly projectName: string;

  /** Modelled domain authority, 0-100. */
  readonly authority: number;
  /** How closely the site's subject matches the project's, 0-100. */
  readonly relevance: number;
  readonly relevanceBand: RelevanceBand;
  /** Modelled monthly traffic to the referring site. */
  readonly traffic: number;
  /** How many sites this one links out to, as a dilution signal. */
  readonly outboundDomains: number;

  /** Backlink ids from this domain. */
  readonly linkIds: readonly string[];
  readonly linkCount: number;
  /** Links from here that are followed. */
  readonly followedLinks: number;
  /** Our pages this domain points at. */
  readonly targetPageCount: number;

  readonly relationship: DomainRelationship;
  /** ISO 8601 of the first modelled link from this domain. */
  readonly firstSeen: string;
  /** ISO 8601 of the most recent. */
  readonly lastSeen: string;

  readonly quality: AuthorityScore;
  readonly band: LinkQualityBand;
  /** Risk signals against the domain, worst first. Empty is clean. */
  readonly toxicSignals: readonly ToxicSignal[];
  readonly toxicScore: number;
  readonly provenance: LinkProvenance;
};

// ---------------------------------------------------------------------------
// The backlink record
// ---------------------------------------------------------------------------

/**
 * One link, from one page on a referring domain to one page of ours.
 *
 * The target is a canonical content record, referenced by `contentId` — the
 * page earning the link is the same page every other module describes.
 */
export type Backlink = {
  readonly id: string;
  readonly domainId: string;
  readonly domain: string;
  readonly projectId: string;
  readonly projectName: string;

  /** The referring page, as a path. Modelled. */
  readonly sourcePath: string;
  /** The canonical content record this points at. Always resolvable. */
  readonly contentId: string;
  readonly targetTitle: string;
  readonly targetPath: string;
  readonly clusterId: string;
  readonly clusterName: string;

  readonly kind: LinkKind;
  readonly rel: LinkRel;
  readonly status: LinkStatus;
  readonly placement: LinkPlacement;

  readonly anchorText: string;
  readonly anchorKind: AnchorKind;

  /** Modelled authority of the referring domain, copied for dense rows. */
  readonly domainAuthority: number;
  /** What this one link is worth, 0-100. */
  readonly quality: AuthorityScore;
  readonly band: LinkQualityBand;
  /** Estimated referral sessions a month from this link. */
  readonly referralTraffic: number;

  /** ISO 8601. */
  readonly firstSeen: string;
  /** ISO 8601, or null while the link is live. */
  readonly lostAt: string | null;

  readonly toxicSignals: readonly ToxicSignal[];
  readonly toxicScore: number;
  readonly provenance: LinkProvenance;
  readonly seed: number;
};

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

/** One anchor classification, counted across a selection. */
export type AnchorRow = {
  readonly kind: AnchorKind;
  readonly label: string;
  readonly links: number;
  /** Share of followed links carrying this kind, 0-100. */
  readonly share: number;
  /** The healthy ceiling for this kind, 0-100. */
  readonly ceiling: number;
  /** True where the share is past the ceiling. */
  readonly overWeighted: boolean;
  /** The most common actual anchors of this kind. */
  readonly examples: readonly string[];
  readonly tone: BadgeTone;
  readonly description: string;
};

export type AnchorProfile = {
  readonly rows: readonly AnchorRow[];
  /** Followed links the profile is computed over. */
  readonly followedLinks: number;
  readonly score: AuthorityScore;
  /** Kinds past their ceiling. */
  readonly overWeighted: readonly AnchorKind[];
  readonly summary: string;
};

// ---------------------------------------------------------------------------
// Link-earning pages
// ---------------------------------------------------------------------------

/** One of our pages, read for the links it has earned. */
export type LinkedPage = {
  readonly contentId: string;
  readonly title: string;
  readonly path: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly clusterId: string;
  readonly clusterName: string;

  readonly links: number;
  readonly referringDomains: number;
  readonly followedLinks: number;
  readonly lostLinks: number;
  /** Mean authority of the domains linking here, 0-100. */
  readonly averageAuthority: number;
  /** Combined link value reaching this page, 0-100. */
  readonly pageAuthority: AuthorityScore;
  readonly referralTraffic: number;
  /** Internal links into the page, from the canonical content layer. */
  readonly internalLinksIn: number;
  /** True where the page earns links but passes little on internally. */
  readonly underLinkedInternally: boolean;
};

// ---------------------------------------------------------------------------
// Competitor link gaps
// ---------------------------------------------------------------------------

/**
 * A domain linking to a rival and not to us.
 *
 * Rivals come from the Competitor Intelligence registry by id — this module
 * does not keep its own competitor list.
 */
export type LinkGap = {
  readonly id: string;
  readonly domain: string;
  readonly domainId: string | null;
  readonly projectId: string;
  readonly projectName: string;
  /** Competitor record ids this domain links to. */
  readonly competitorIds: readonly string[];
  readonly competitorNames: readonly string[];
  /** How many of the tracked rivals it links to. */
  readonly rivalsLinked: number;
  readonly authority: number;
  readonly relevance: number;
  readonly category: DomainCategory;
  /** What winning this link would be worth, 0-100. */
  readonly value: number;
  /** How realistic winning it is, 0-100. */
  readonly winnability: number;
  readonly suggestedKind: OutreachKind;
  readonly reason: string;
  readonly provenance: LinkProvenance;
};

// ---------------------------------------------------------------------------
// Outreach opportunities
// ---------------------------------------------------------------------------

/** One authority job somebody could schedule. */
export type OutreachOpportunity = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly kind: OutreachKind;
  readonly title: string;
  readonly explanation: string;
  readonly impact: string;
  readonly action: string;

  /** The domain this is about, where it is about one. */
  readonly domain: string | null;
  /** The page it would point at, where it has one. */
  readonly contentId: string | null;
  readonly targetTitle: string | null;
  /** Backlink ids behind the job, for reclamation work. */
  readonly linkIds: readonly string[];
  readonly affectedLinks: number;

  readonly severity: LinkSeverity;
  readonly effort: OutreachEffort;
  /** Modelled authority of the domain in play, 0-100. */
  readonly authority: number;
  /** What winning it is worth, 0-100. */
  readonly value: number;
  /** Value against effort, 0-100. */
  readonly priority: number;
  /** Estimated monthly referral sessions if won. */
  readonly estimatedTraffic: number;
  readonly owner: AgentId;
  readonly stage: OutreachStage;
  readonly provenance: LinkProvenance;
};

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

export type LinkMetric = {
  readonly id: string;
  readonly label: string;
  /** Pre-formatted for display. */
  readonly value: string;
  readonly unit?: string;
  readonly detail: string;
  readonly icon: IconName;
  readonly health?: MetricHealth;
};

export type LinkDistributionRow = {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly share: number;
  readonly tone: BadgeTone;
  readonly description: string;
};

/** Links gained against links lost over the window. */
export type LinkVelocity = {
  readonly newLinks: number;
  readonly lostLinks: number;
  readonly net: number;
  readonly newDomains: number;
  readonly lostDomains: number;
  /** Share of links gained that are still live, 0-100. */
  readonly retention: number;
  readonly summary: string;
};

/** The risk reading for a selection. */
export type RiskSummary = {
  readonly flaggedLinks: number;
  readonly flaggedDomains: number;
  readonly disavowCandidates: number;
  readonly removalCandidates: number;
  readonly reviewCandidates: number;
  /** Share of the profile carrying any risk signal, 0-100. */
  readonly toxicShare: number;
  readonly score: AuthorityScore;
  readonly signals: readonly LinkDistributionRow[];
};

export type AuthorityOverview = {
  readonly authority: AuthorityScore;
  readonly metrics: readonly LinkMetric[];
  readonly velocity: LinkVelocity;
  readonly risk: RiskSummary;
  readonly anchors: AnchorProfile;
  readonly quality: readonly LinkDistributionRow[];
  readonly categories: readonly LinkDistributionRow[];
  readonly relevance: readonly LinkDistributionRow[];
  /** Strongest domains first. */
  readonly topDomains: readonly ReferringDomain[];
  /** Best link-earning pages first. */
  readonly topPages: readonly LinkedPage[];
  readonly topOpportunities: readonly OutreachOpportunity[];
  readonly topGaps: readonly LinkGap[];
};

/** Counts and an integrity pass, for the development inspector. */
export type BacklinkDatasetCounts = {
  readonly domains: number;
  readonly links: number;
  readonly pages: number;
  readonly gaps: number;
  readonly opportunities: number;
  readonly projects: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly byKind: Readonly<Record<string, number>>;
  readonly byRel: Readonly<Record<string, number>>;
  readonly byAnchorKind: Readonly<Record<string, number>>;
  readonly byBand: Readonly<Record<string, number>>;
  readonly byCategory: Readonly<Record<string, number>>;
  readonly byRelevance: Readonly<Record<string, number>>;
  readonly byRelationship: Readonly<Record<string, number>>;
  readonly byPlacement: Readonly<Record<string, number>>;
  readonly byToxicSignal: Readonly<Record<string, number>>;
  readonly byOutreachKind: Readonly<Record<string, number>>;
  /** Distinct link quality scores, as a check against a flat dataset. */
  readonly distinctQualityScores: number;
  /** Findings the integrity pass raised. Empty is the passing result. */
  readonly integrity: readonly string[];
};
