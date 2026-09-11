import { SEVERITY_RANK } from "@/lib/mock/backlinks";
import type {
  AnchorKind,
  Backlink,
  DomainCategory,
  DomainRelationship,
  LinkGap,
  LinkKind,
  LinkQualityBand,
  LinkRel,
  LinkSeverity,
  LinkStatus,
  LinkedPage,
  OutreachKind,
  ReferringDomain,
  RelevanceBand,
} from "@/types/backlinks";

/**
 * Filtering for Backlinks & Authority.
 *
 * One filter object over five record shapes — links, domains, pages, gaps and
 * jobs. Somebody narrowing to one project or one quality band expects all five
 * to narrow together, so they share a state object and the workspace applies
 * them in a fixed order: links first, then everything that hangs off the links
 * that survived.
 *
 * That order is what keeps a tab count and the table it labels describing the
 * same set. Filtering domains independently would leave a domain on screen
 * whose links had all been filtered away.
 */

export type LinkFilters = {
  /** Matched against domain, anchor, target page, project and cluster. */
  readonly query: string;
  /** Project id, or "all". */
  readonly project: string;
  /** Referring domain id, or "all". */
  readonly domain: string;
  readonly status: LinkStatus | "all";
  readonly quality: LinkQualityBand | "all";
  readonly rel: LinkRel | "all";
  readonly kind: LinkKind | "all";
  readonly anchorKind: AnchorKind | "all";
  readonly category: DomainCategory | "all";
  readonly relevance: RelevanceBand | "all";
  readonly relationship: DomainRelationship | "all";
  readonly outreachKind: OutreachKind | "all";
  readonly severity: LinkSeverity | "all";
  /** Narrows to links and domains carrying at least one risk signal. */
  readonly flaggedOnly: boolean;
};

export const EMPTY_LINK_FILTERS: LinkFilters = {
  query: "",
  project: "all",
  domain: "all",
  status: "all",
  quality: "all",
  rel: "all",
  kind: "all",
  anchorKind: "all",
  category: "all",
  relevance: "all",
  relationship: "all",
  outreachKind: "all",
  severity: "all",
  flaggedOnly: false,
};

const COUNTED: readonly (keyof LinkFilters)[] = [
  "project",
  "domain",
  "status",
  "quality",
  "rel",
  "kind",
  "anchorKind",
  "category",
  "relevance",
  "relationship",
  "outreachKind",
  "severity",
];

export function activeLinkFilterCount(filters: LinkFilters): number {
  return (
    COUNTED.filter((key) => filters[key] !== "all").length +
    (filters.flaggedOnly ? 1 : 0)
  );
}

export function hasActiveLinkFilters(filters: LinkFilters): boolean {
  return filters.query.trim().length > 0 || activeLinkFilterCount(filters) > 0;
}

function matches(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return haystack.toLowerCase().includes(needle);
}

export function linkMatchesQuery(link: Backlink, query: string): boolean {
  return matches(
    `${link.domain} ${link.anchorText} ${link.targetTitle} ${link.targetPath} ${link.projectName} ${link.clusterName}`,
    query,
  );
}

/**
 * Whether a link survives the filters.
 *
 * The domain-level filters — category, relevance, relationship — reach links
 * through the domain they came from, which is passed in rather than looked up,
 * so the predicate stays pure and the workspace controls the join.
 */
export function matchesLink(
  link: Backlink,
  filters: LinkFilters,
  domain: ReferringDomain | undefined,
): boolean {
  if (!linkMatchesQuery(link, filters.query)) return false;
  if (filters.project !== "all" && link.projectId !== filters.project) return false;
  if (filters.domain !== "all" && link.domainId !== filters.domain) return false;
  if (filters.status !== "all" && link.status !== filters.status) return false;
  if (filters.quality !== "all" && link.band !== filters.quality) return false;
  if (filters.rel !== "all" && link.rel !== filters.rel) return false;
  if (filters.kind !== "all" && link.kind !== filters.kind) return false;
  if (filters.anchorKind !== "all" && link.anchorKind !== filters.anchorKind) {
    return false;
  }
  if (filters.flaggedOnly && link.toxicSignals.length === 0) return false;

  if (domain !== undefined) {
    if (filters.category !== "all" && domain.category !== filters.category) {
      return false;
    }
    if (filters.relevance !== "all" && domain.relevanceBand !== filters.relevance) {
      return false;
    }
    if (
      filters.relationship !== "all" &&
      domain.relationship !== filters.relationship
    ) {
      return false;
    }
  }

  return true;
}

/** Whether a referring domain survives, given the links that did. */
export function matchesDomain(
  domain: ReferringDomain,
  filters: LinkFilters,
  linkIds: ReadonlySet<string>,
): boolean {
  if (filters.project !== "all" && domain.projectId !== filters.project) return false;
  if (filters.domain !== "all" && domain.id !== filters.domain) return false;
  if (filters.category !== "all" && domain.category !== filters.category) return false;
  if (filters.relevance !== "all" && domain.relevanceBand !== filters.relevance) {
    return false;
  }
  if (
    filters.relationship !== "all" &&
    domain.relationship !== filters.relationship
  ) {
    return false;
  }
  if (filters.flaggedOnly && domain.toxicSignals.length === 0) return false;
  if (
    !matches(
      `${domain.domain} ${domain.name} ${domain.projectName} ${domain.category}`,
      filters.query,
    ) &&
    !domain.linkIds.some((id) => linkIds.has(id))
  ) {
    return false;
  }
  return domain.linkIds.some((id) => linkIds.has(id));
}

/**
 * Whether one of our pages survives.
 *
 * A page with no links at all is kept while no link-level filter is active:
 * a published page that has earned nothing is one of the findings this module
 * exists to surface, and dropping it for having no links would hide it.
 */
export function matchesPage(
  page: LinkedPage,
  filters: LinkFilters,
  contentIds: ReadonlySet<string>,
): boolean {
  if (filters.project !== "all" && page.projectId !== filters.project) return false;
  if (
    !matches(
      `${page.title} ${page.path} ${page.projectName} ${page.clusterName}`,
      filters.query,
    )
  ) {
    return false;
  }
  if (page.links === 0) {
    return (
      filters.domain === "all" &&
      filters.status === "all" &&
      filters.quality === "all" &&
      filters.rel === "all" &&
      filters.kind === "all" &&
      filters.anchorKind === "all" &&
      filters.category === "all" &&
      filters.relevance === "all" &&
      filters.relationship === "all" &&
      !filters.flaggedOnly
    );
  }
  return contentIds.has(page.contentId);
}

/**
 * Whether an authority job survives the search.
 *
 * The queue is narrowed by project, kind and severity in the workspace, which
 * owns the link scope; this is the text half. Without it a search that matched
 * no link would still leave every competitor-gap job on screen, because those
 * carry no link to be narrowed by.
 */
export function opportunityMatchesQuery(
  entry: {
    readonly title: string;
    readonly explanation: string;
    readonly domain: string | null;
    readonly targetTitle: string | null;
    readonly projectName: string;
  },
  query: string,
): boolean {
  return matches(
    `${entry.title} ${entry.explanation} ${entry.domain ?? ""} ${entry.targetTitle ?? ""} ${entry.projectName}`,
    query,
  );
}

export function matchesGap(gap: LinkGap, filters: LinkFilters): boolean {
  if (filters.project !== "all" && gap.projectId !== filters.project) return false;
  if (filters.category !== "all" && gap.category !== filters.category) return false;
  if (
    filters.outreachKind !== "all" &&
    gap.suggestedKind !== filters.outreachKind
  ) {
    return false;
  }
  return matches(
    `${gap.domain} ${gap.projectName} ${gap.competitorNames.join(" ")} ${gap.reason}`,
    filters.query,
  );
}

export { SEVERITY_RANK };
