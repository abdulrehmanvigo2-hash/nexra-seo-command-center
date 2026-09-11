import type {
  Backlink,
  LinkGap,
  LinkedPage,
  ReferringDomain,
} from "@/types/backlinks";

/**
 * Ordering for the authority tables.
 *
 * Four sets of keys, one per table shape, kept beside the workspace rather
 * than inside the tables because a sort has to survive a filter change, a page
 * change and a tab change.
 *
 * Every key sorts both directions. Ties break on id the same way whichever way
 * the column points, so equal rows do not reshuffle when a reader flips the
 * arrow to look at the other end.
 */

// ---------------------------------------------------------------------------
// Backlinks
// ---------------------------------------------------------------------------

export type LinkSort =
  | "quality"
  | "authority"
  | "referral"
  | "risk"
  | "firstSeen"
  | "domain"
  | "anchor";

export const LINK_SORT_OPTIONS: readonly {
  readonly value: LinkSort;
  readonly label: string;
  /** The direction most people want first. */
  readonly desc: boolean;
}[] = [
  { value: "quality", label: "Link quality", desc: true },
  { value: "authority", label: "Domain authority", desc: true },
  { value: "referral", label: "Referral traffic", desc: true },
  { value: "risk", label: "Risk score", desc: true },
  { value: "firstSeen", label: "First seen", desc: true },
  { value: "domain", label: "Referring domain", desc: false },
  { value: "anchor", label: "Anchor text", desc: false },
];

export function compareLinks(
  a: Backlink,
  b: Backlink,
  sort: { key: LinkSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "domain") {
    return (
      a.domain.localeCompare(b.domain) * direction || a.id.localeCompare(b.id)
    );
  }
  if (sort.key === "anchor") {
    return (
      a.anchorText.localeCompare(b.anchorText) * direction ||
      a.id.localeCompare(b.id)
    );
  }
  if (sort.key === "firstSeen") {
    return (
      a.firstSeen.localeCompare(b.firstSeen) * direction ||
      a.id.localeCompare(b.id)
    );
  }

  const read: Record<
    Exclude<LinkSort, "domain" | "anchor" | "firstSeen">,
    (link: Backlink) => number
  > = {
    quality: (link) => link.quality.score,
    authority: (link) => link.domainAuthority,
    referral: (link) => link.referralTraffic,
    risk: (link) => link.toxicScore,
  };

  return (read[sort.key](a) - read[sort.key](b)) * direction ||
    a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Referring domains
// ---------------------------------------------------------------------------

export type DomainSort =
  | "quality"
  | "authority"
  | "relevance"
  | "links"
  | "followed"
  | "traffic"
  | "risk"
  | "domain";

export const DOMAIN_SORT_OPTIONS: readonly {
  readonly value: DomainSort;
  readonly label: string;
  readonly desc: boolean;
}[] = [
  { value: "quality", label: "Domain quality", desc: true },
  { value: "authority", label: "Domain authority", desc: true },
  { value: "relevance", label: "Topical relevance", desc: true },
  { value: "links", label: "Links to us", desc: true },
  { value: "followed", label: "Followed links", desc: true },
  { value: "traffic", label: "Site traffic", desc: true },
  { value: "risk", label: "Risk score", desc: true },
  { value: "domain", label: "Domain", desc: false },
];

export function compareDomains(
  a: ReferringDomain,
  b: ReferringDomain,
  sort: { key: DomainSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "domain") {
    return (
      a.domain.localeCompare(b.domain) * direction || a.id.localeCompare(b.id)
    );
  }

  const read: Record<
    Exclude<DomainSort, "domain">,
    (domain: ReferringDomain) => number
  > = {
    quality: (domain) => domain.quality.score,
    authority: (domain) => domain.authority,
    relevance: (domain) => domain.relevance,
    links: (domain) => domain.linkCount,
    followed: (domain) => domain.followedLinks,
    traffic: (domain) => domain.traffic,
    risk: (domain) => domain.toxicScore,
  };

  return (read[sort.key](a) - read[sort.key](b)) * direction ||
    a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Our pages
// ---------------------------------------------------------------------------

export type PageSort =
  | "authority"
  | "domains"
  | "links"
  | "followed"
  | "referral"
  | "lost"
  | "internal"
  | "title";

export const PAGE_SORT_OPTIONS: readonly {
  readonly value: PageSort;
  readonly label: string;
  readonly desc: boolean;
}[] = [
  { value: "authority", label: "Page authority", desc: true },
  { value: "domains", label: "Referring domains", desc: true },
  { value: "links", label: "Links", desc: true },
  { value: "followed", label: "Followed links", desc: true },
  { value: "referral", label: "Referral traffic", desc: true },
  { value: "lost", label: "Lost links", desc: true },
  { value: "internal", label: "Internal links in", desc: false },
  { value: "title", label: "Page title", desc: false },
];

export function comparePages(
  a: LinkedPage,
  b: LinkedPage,
  sort: { key: PageSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "title") {
    return (
      a.title.localeCompare(b.title) * direction ||
      a.contentId.localeCompare(b.contentId)
    );
  }

  const read: Record<Exclude<PageSort, "title">, (page: LinkedPage) => number> = {
    authority: (page) => page.pageAuthority.score,
    domains: (page) => page.referringDomains,
    links: (page) => page.links,
    followed: (page) => page.followedLinks,
    referral: (page) => page.referralTraffic,
    lost: (page) => page.lostLinks,
    internal: (page) => page.internalLinksIn,
  };

  return (read[sort.key](a) - read[sort.key](b)) * direction ||
    a.contentId.localeCompare(b.contentId);
}

// ---------------------------------------------------------------------------
// Competitor gaps
// ---------------------------------------------------------------------------

export type GapSort =
  | "value"
  | "authority"
  | "relevance"
  | "winnability"
  | "rivals"
  | "domain";

export const GAP_SORT_OPTIONS: readonly {
  readonly value: GapSort;
  readonly label: string;
  readonly desc: boolean;
}[] = [
  { value: "value", label: "Opportunity value", desc: true },
  { value: "authority", label: "Domain authority", desc: true },
  { value: "relevance", label: "Topical relevance", desc: true },
  { value: "winnability", label: "Winnability", desc: true },
  { value: "rivals", label: "Rivals linked", desc: true },
  { value: "domain", label: "Domain", desc: false },
];

export function compareGaps(
  a: LinkGap,
  b: LinkGap,
  sort: { key: GapSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "domain") {
    return (
      a.domain.localeCompare(b.domain) * direction || a.id.localeCompare(b.id)
    );
  }

  const read: Record<Exclude<GapSort, "domain">, (gap: LinkGap) => number> = {
    value: (gap) => gap.value,
    authority: (gap) => gap.authority,
    relevance: (gap) => gap.relevance,
    winnability: (gap) => gap.winnability,
    rivals: (gap) => gap.rivalsLinked,
  };

  return (read[sort.key](a) - read[sort.key](b)) * direction ||
    a.id.localeCompare(b.id);
}
