import type {
  AnchorKind,
  DomainCategory,
  DomainRelationship,
  LinkKind,
  LinkKindMeta,
  LinkPlacement,
  LinkProvenance,
  LinkQualityBand,
  LinkRel,
  LinkSeverity,
  LinkStateMeta,
  LinkStatus,
  OutreachKind,
  OutreachKindMeta,
  OutreachStage,
  RelevanceBand,
  ToxicAction,
  ToxicSignal,
  ToxicSignalMeta,
} from "@/types/backlinks";
import {
  QUALITY_ORDER,
  RELEVANCE_ORDER,
  SEVERITY_ORDER,
} from "@/lib/mock/backlinks/scoring";

/**
 * Every label, tone, order and explanation in Backlinks & Authority.
 *
 * Vocabulary lives here rather than in the components, so a link status reads
 * the same on the overview, in a table row, on a filter chip and on a project
 * page. A component that writes its own label is one that disagrees with the
 * next one.
 */

/** Stated wherever a backlink figure appears. */
export const LINK_SOURCE_NOTE =
  "Modelled link intelligence from the development dataset. No crawler, link index, or third-party backlink provider is connected, and every referring domain is invented for the demo on the reserved .example TLD.";

export const LINK_SOURCE_SHORT =
  "Modelled link profile — no backlink data provider is connected.";

export const PROVENANCE_META: Readonly<
  Record<LinkProvenance, { label: string; description: string }>
> = {
  derived: {
    label: "Derived",
    description:
      "Arithmetic over canonical records this product owns — which page a link targets, what that page scores, which project it belongs to.",
  },
  modelled: {
    label: "Modelled",
    description:
      "A deterministic stand-in for something only a link-data provider could report. Stable across renders, and not observed data.",
  },
};

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

export { QUALITY_ORDER, RELEVANCE_ORDER, SEVERITY_ORDER };

export const QUALITY_META: Readonly<Record<LinkQualityBand, LinkStateMeta>> = {
  excellent: {
    label: "Excellent",
    tone: "positive",
    description: "Strong, relevant, and followed. Worth protecting.",
  },
  strong: {
    label: "Strong",
    tone: "positive",
    description: "A good link with one factor short of excellent.",
  },
  average: {
    label: "Average",
    tone: "accent",
    description: "Contributes something without moving much.",
  },
  weak: {
    label: "Weak",
    tone: "warning",
    description: "Little authority, relevance, or both.",
  },
  harmful: {
    label: "Harmful",
    tone: "critical",
    description:
      "Carries risk signals that outweigh anything it contributes. Worth removing or disavowing.",
  },
};

export const SEVERITY_META: Readonly<Record<LinkSeverity, LinkStateMeta>> = {
  critical: {
    label: "Critical",
    tone: "critical",
    description: "Actively damaging. Deal with it now.",
  },
  high: {
    label: "High",
    tone: "critical",
    description: "Costing authority or carrying real risk.",
  },
  medium: {
    label: "Medium",
    tone: "warning",
    description: "Worth handling in the next cycle.",
  },
  low: {
    label: "Low",
    tone: "neutral",
    description: "Monitor. Nothing is waiting on it.",
  },
};

export const RELEVANCE_META: Readonly<Record<RelevanceBand, LinkStateMeta>> = {
  direct: {
    label: "Direct",
    tone: "positive",
    description: "The site covers our subject.",
  },
  adjacent: {
    label: "Adjacent",
    tone: "accent",
    description: "A neighbouring subject its audience overlaps with.",
  },
  peripheral: {
    label: "Peripheral",
    tone: "warning",
    description: "Loosely connected. Passes little topical signal.",
  },
  unrelated: {
    label: "Unrelated",
    tone: "critical",
    description: "Nothing to do with what we publish.",
  },
};

// ---------------------------------------------------------------------------
// Link states
// ---------------------------------------------------------------------------

export const LINK_STATUS_ORDER: readonly LinkStatus[] = [
  "live",
  "new",
  "lost",
  "redirected",
  "broken",
];

export const LINK_STATUS_META: Readonly<Record<LinkStatus, LinkStateMeta>> = {
  live: {
    label: "Live",
    tone: "positive",
    description: "In place and resolving.",
  },
  new: {
    label: "New",
    tone: "accent",
    description: "First seen inside the reporting window.",
  },
  lost: {
    label: "Lost",
    tone: "critical",
    description: "The referring page no longer carries it.",
  },
  redirected: {
    label: "Redirected",
    tone: "warning",
    description: "Still present, but pointing through a redirect.",
  },
  broken: {
    label: "Broken",
    tone: "critical",
    description: "Points at a URL of ours that does not serve.",
  },
};

export const LINK_KIND_ORDER: readonly LinkKind[] = [
  "editorial",
  "digital-pr",
  "guest-post",
  "resource-page",
  "unlinked-mention",
  "broken-link-rebuild",
  "syndication",
  "directory",
  "forum",
  "sponsored",
];

export const LINK_KIND_META: Readonly<Record<LinkKind, LinkKindMeta>> = {
  editorial: {
    label: "Editorial",
    icon: "note",
    description: "Given freely by a writer citing the page.",
  },
  "guest-post": {
    label: "Guest post",
    icon: "edit",
    description: "Placed in an article we wrote for the site.",
  },
  "digital-pr": {
    label: "Digital PR",
    icon: "sparkles",
    description: "Earned through a campaign or a piece of research.",
  },
  "resource-page": {
    label: "Resource page",
    icon: "list",
    description: "Listed on a curated page of useful links.",
  },
  directory: {
    label: "Directory",
    icon: "grid",
    description: "A listing rather than a recommendation.",
  },
  "unlinked-mention": {
    label: "Converted mention",
    icon: "handoff",
    description: "A brand mention that was turned into a link.",
  },
  "broken-link-rebuild": {
    label: "Broken-link rebuild",
    icon: "refresh",
    description: "Replaced a dead link the site was already carrying.",
  },
  syndication: {
    label: "Syndication",
    icon: "workflow",
    description: "Our content republished elsewhere with attribution.",
  },
  forum: {
    label: "Community",
    icon: "agents",
    description: "Posted in a forum or community thread.",
  },
  sponsored: {
    label: "Sponsored",
    icon: "value",
    description: "Paid placement, marked as such.",
  },
};

export const LINK_REL_ORDER: readonly LinkRel[] = [
  "follow",
  "nofollow",
  "ugc",
  "sponsored",
];

export const LINK_REL_META: Readonly<Record<LinkRel, LinkStateMeta>> = {
  follow: {
    label: "Follow",
    tone: "positive",
    description: "Carries ranking signal as well as referral traffic.",
  },
  nofollow: {
    label: "Nofollow",
    tone: "neutral",
    description:
      "Referral and brand value only. Not worthless — just not a ranking signal.",
  },
  ugc: {
    label: "UGC",
    tone: "neutral",
    description: "Marked as user-generated content.",
  },
  sponsored: {
    label: "Sponsored",
    tone: "warning",
    description: "Declared as paid.",
  },
};

export const PLACEMENT_ORDER: readonly LinkPlacement[] = [
  "in-content",
  "list",
  "author-bio",
  "sidebar",
  "footer",
];

export const PLACEMENT_META: Readonly<Record<LinkPlacement, LinkStateMeta>> = {
  "in-content": {
    label: "In content",
    tone: "positive",
    description: "Inside the body, where a reader would actually follow it.",
  },
  list: {
    label: "In a list",
    tone: "accent",
    description: "One entry among several on a curated page.",
  },
  "author-bio": {
    label: "Author bio",
    tone: "neutral",
    description: "In a byline block rather than the article itself.",
  },
  sidebar: {
    label: "Sidebar",
    tone: "neutral",
    description: "Off to the side, rarely followed.",
  },
  footer: {
    label: "Footer",
    tone: "warning",
    description: "Sitewide placement, which carries little and looks bought.",
  },
};

/** How much each placement contributes to a link's quality, 0-100. */
export const PLACEMENT_VALUE: Readonly<Record<LinkPlacement, number>> = {
  "in-content": 100,
  list: 68,
  "author-bio": 44,
  sidebar: 30,
  footer: 14,
};

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

export const ANCHOR_ORDER: readonly AnchorKind[] = [
  "branded",
  "page-title",
  "partial-match",
  "exact-match",
  "generic",
  "naked-url",
  "image",
];

export const ANCHOR_META: Readonly<Record<AnchorKind, LinkStateMeta>> = {
  "exact-match": {
    label: "Exact match",
    tone: "warning",
    description:
      "The target keyword, word for word. Valuable in small numbers and the clearest manipulation signal in large ones.",
  },
  "partial-match": {
    label: "Partial match",
    tone: "accent",
    description: "Contains the target term inside a longer phrase.",
  },
  branded: {
    label: "Branded",
    tone: "positive",
    description: "The company name. What a natural profile is mostly made of.",
  },
  "naked-url": {
    label: "Naked URL",
    tone: "neutral",
    description: "The address itself, pasted as the anchor.",
  },
  generic: {
    label: "Generic",
    tone: "neutral",
    description: '"Read more", "here", "this guide".',
  },
  image: {
    label: "Image",
    tone: "neutral",
    description: "An image link, carrying its alt text as the anchor.",
  },
  "page-title": {
    label: "Page title",
    tone: "positive",
    description: "The title of the page being linked to.",
  },
};

// ---------------------------------------------------------------------------
// Referring domains
// ---------------------------------------------------------------------------

export const CATEGORY_ORDER: readonly DomainCategory[] = [
  "publisher",
  "trade-media",
  "blog",
  "association",
  "education",
  "government",
  "vendor",
  "community",
  "directory",
  "aggregator",
];

export const CATEGORY_META: Readonly<Record<DomainCategory, LinkKindMeta>> = {
  publisher: {
    label: "Publisher",
    icon: "note",
    description: "A general news or magazine title.",
  },
  "trade-media": {
    label: "Trade media",
    icon: "briefcase",
    description: "An industry title read by the market we sell to.",
  },
  blog: {
    label: "Blog",
    icon: "edit",
    description: "An independent site with its own audience.",
  },
  directory: {
    label: "Directory",
    icon: "grid",
    description: "A listing site. Rarely worth much on its own.",
  },
  education: {
    label: "Education",
    icon: "brief",
    description: "A school, college, or university site.",
  },
  government: {
    label: "Government",
    icon: "shield",
    description: "A public-sector site.",
  },
  association: {
    label: "Association",
    icon: "agents",
    description: "A trade body or professional association.",
  },
  vendor: {
    label: "Vendor",
    icon: "workflow",
    description: "A supplier, partner, or integration listing.",
  },
  community: {
    label: "Community",
    icon: "globe",
    description: "A forum, group, or Q&A site.",
  },
  aggregator: {
    label: "Aggregator",
    icon: "layers",
    description: "A site that republishes other people's content.",
  },
};

export const RELATIONSHIP_ORDER: readonly DomainRelationship[] = [
  "recurring",
  "one-off",
  "declining",
  "lapsed",
];

export const RELATIONSHIP_META: Readonly<
  Record<DomainRelationship, LinkStateMeta>
> = {
  recurring: {
    label: "Recurring",
    tone: "positive",
    description: "Links to us repeatedly. The relationship is working.",
  },
  "one-off": {
    label: "One-off",
    tone: "accent",
    description: "Linked once and has not come back.",
  },
  declining: {
    label: "Declining",
    tone: "warning",
    description: "Was linking regularly and has slowed.",
  },
  lapsed: {
    label: "Lapsed",
    tone: "critical",
    description: "Every link from this domain has now been lost.",
  },
};

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export const TOXIC_SIGNAL_ORDER: readonly ToxicSignal[] = [
  "link-farm",
  "paid-undisclosed",
  "expired-domain",
  "foreign-language-spam",
  "anchor-over-optimised",
  "sitewide-footer",
  "low-quality-directory",
  "irrelevant-topic",
];

export const TOXIC_ACTION_META: Readonly<Record<ToxicAction, LinkStateMeta>> = {
  monitor: {
    label: "Monitor",
    tone: "neutral",
    description: "Note it and watch. No action yet.",
  },
  review: {
    label: "Review",
    tone: "warning",
    description: "Needs a human to look before anything is decided.",
  },
  "request-removal": {
    label: "Request removal",
    tone: "warning",
    description: "Ask the site to take it down before escalating.",
  },
  disavow: {
    label: "Disavow",
    tone: "critical",
    description: "Bad enough to formally disown.",
  },
};

export const TOXIC_SIGNAL_META: Readonly<
  Record<ToxicSignal, ToxicSignalMeta>
> = {
  "link-farm": {
    label: "Link farm",
    icon: "alert",
    severity: "critical",
    description: "The site exists to sell links and little else.",
    impact:
      "Association with a link network is the clearest negative signal a profile can carry.",
    action: "disavow",
  },
  "paid-undisclosed": {
    label: "Undisclosed paid link",
    icon: "value",
    severity: "critical",
    description: "A placement that looks bought and is not marked as such.",
    impact:
      "An undeclared paid link breaks the rules it was meant to quietly exploit.",
    action: "request-removal",
  },
  "expired-domain": {
    label: "Expired domain",
    icon: "clock",
    severity: "high",
    description:
      "A domain that changed hands and kept its history rather than its purpose.",
    impact: "Whatever authority it had belongs to a site that no longer exists.",
    action: "disavow",
  },
  "foreign-language-spam": {
    label: "Off-market spam",
    icon: "globe",
    severity: "high",
    description: "A site in a language and market we do not serve.",
    impact: "Sends no useful audience and looks like a scraped placement.",
    action: "disavow",
  },
  "anchor-over-optimised": {
    label: "Over-optimised anchor",
    icon: "target",
    severity: "medium",
    description: "An exact-match anchor on a page that has no reason to use one.",
    impact:
      "A handful is normal; a pattern of them is the signal that a profile was built rather than earned.",
    action: "review",
  },
  "sitewide-footer": {
    label: "Sitewide footer link",
    icon: "rows",
    severity: "medium",
    description: "The same link repeated on every page of the referring site.",
    impact: "Passes almost nothing and reads as an arrangement rather than a citation.",
    action: "request-removal",
  },
  "low-quality-directory": {
    label: "Low-quality directory",
    icon: "grid",
    severity: "low",
    description: "An unmoderated listing anyone can add themselves to.",
    impact: "Contributes nothing. Mostly harmless in small numbers.",
    action: "monitor",
  },
  "irrelevant-topic": {
    label: "Irrelevant subject",
    icon: "split",
    severity: "low",
    description: "A real site with nothing to do with what we publish.",
    impact: "Passes no topical signal, and dilutes the profile's coherence.",
    action: "monitor",
  },
};

// ---------------------------------------------------------------------------
// Outreach
// ---------------------------------------------------------------------------

export const OUTREACH_KIND_ORDER: readonly OutreachKind[] = [
  "competitor-gap",
  "reclaim-lost",
  "unlinked-mention",
  "broken-link",
  "digital-pr",
  "resource-page",
  "guest-post",
  "relationship-revival",
  "internal-authority",
  "disavow",
];

/**
 * What each kind of authority job involves.
 *
 * Effort is a property of the kind, not of the individual job — the same
 * discipline the Technical SEO and AI Visibility queues use, so all three
 * rank consistently when an agency looks at them together.
 */
export const OUTREACH_KIND_META: Readonly<
  Record<OutreachKind, OutreachKindMeta>
> = {
  "digital-pr": {
    label: "Digital PR",
    icon: "sparkles",
    description: "Earn coverage with research or a story worth writing about.",
    effort: "high",
    owner: "authority-backlink",
  },
  "unlinked-mention": {
    label: "Convert a mention",
    icon: "handoff",
    description: "The site already named us. Ask for the link.",
    effort: "low",
    owner: "authority-backlink",
  },
  "resource-page": {
    label: "Resource page",
    icon: "list",
    description: "A curated list our page belongs on.",
    effort: "medium",
    owner: "authority-backlink",
  },
  "broken-link": {
    label: "Broken-link rebuild",
    icon: "refresh",
    description: "Offer our page in place of a dead link they already carry.",
    effort: "medium",
    owner: "authority-backlink",
  },
  "guest-post": {
    label: "Guest post",
    icon: "edit",
    description: "Write for the site in exchange for a placement.",
    effort: "high",
    owner: "writer",
  },
  "competitor-gap": {
    label: "Competitor gap",
    icon: "competitors",
    description:
      "A site that links to rivals and not to us. It has already shown it will link in this market.",
    effort: "medium",
    owner: "authority-backlink",
  },
  "reclaim-lost": {
    label: "Reclaim a lost link",
    icon: "arrow-left",
    description: "A link we had and no longer have. The cheapest link to win back.",
    effort: "low",
    owner: "authority-backlink",
  },
  "internal-authority": {
    label: "Route internal authority",
    icon: "handoff",
    description:
      "A page earning links that passes little of it on. Fixed with internal links, not outreach.",
    effort: "low",
    owner: "content-strategist",
  },
  disavow: {
    label: "Clean the profile",
    icon: "shield",
    description: "Remove or disown links that are doing damage.",
    effort: "medium",
    owner: "authority-backlink",
  },
  "relationship-revival": {
    label: "Revive a relationship",
    icon: "agents",
    description: "A domain that used to link regularly and has stopped.",
    effort: "low",
    owner: "authority-backlink",
  },
};

export const OUTREACH_STAGE_ORDER: readonly OutreachStage[] = [
  "identified",
  "queued",
  "contacted",
  "negotiating",
  "won",
  "declined",
];

export const OUTREACH_STAGE_META: Readonly<
  Record<OutreachStage, LinkStateMeta>
> = {
  identified: {
    label: "Identified",
    tone: "neutral",
    description: "Found, not yet triaged.",
  },
  queued: {
    label: "Queued",
    tone: "accent",
    description: "Accepted and waiting to start.",
  },
  contacted: {
    label: "Contacted",
    tone: "accent",
    description: "Approach made, awaiting a reply.",
  },
  negotiating: {
    label: "Negotiating",
    tone: "warning",
    description: "In conversation about terms.",
  },
  won: {
    label: "Won",
    tone: "positive",
    description: "The link was placed.",
  },
  declined: {
    label: "Declined",
    tone: "neutral",
    description: "They said no, or we dropped it.",
  },
};

/** The order the stage control cycles through. */
export const OUTREACH_STAGE_CYCLE: readonly OutreachStage[] = [
  "identified",
  "queued",
  "contacted",
  "negotiating",
  "won",
  "declined",
];

export const EFFORT_META: Readonly<
  Record<"low" | "medium" | "high", LinkStateMeta>
> = {
  low: {
    label: "Low effort",
    tone: "positive",
    description: "One email, or one change on our own site.",
  },
  medium: {
    label: "Medium effort",
    tone: "accent",
    description: "A short campaign: a list, an approach, a follow-up.",
  },
  high: {
    label: "High effort",
    tone: "warning",
    description: "Real creative or editorial work before anyone is contacted.",
  },
};
