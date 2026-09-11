import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  QUALITY_META,
  QUALITY_ORDER,
  RELEVANCE_META,
  RELEVANCE_ORDER,
} from "@/lib/mock/backlinks/meta";
import {
  mean,
  projectAuthority,
  ratio,
} from "@/lib/mock/backlinks/scoring";
import {
  BACKLINKS_RANGE,
  backlinksForProject,
  domainsForProject,
  getBacklinks,
  getReferringDomains,
} from "@/lib/mock/backlinks/registry";
import {
  getAllLinkedPages,
  getAnchorProfile,
  getRiskSummary,
  getVelocity,
} from "@/lib/mock/backlinks/profile";
import { getLinkGaps, linkGapsForProject } from "@/lib/mock/backlinks/gaps";
import {
  getOutreachOpportunities,
  outreachForProject,
} from "@/lib/mock/backlinks/opportunities";
import type {
  AuthorityOverview,
  Backlink,
  BacklinkDatasetCounts,
  LinkDistributionRow,
  LinkGap,
  LinkMetric,
  LinkedPage,
  OutreachOpportunity,
  ReferringDomain,
} from "@/types/backlinks";

/**
 * Backlinks & Authority: the module's public surface.
 *
 * Every reading below takes a selection rather than reaching for the whole
 * graph, so narrowing to one project narrows the authority score, the anchor
 * profile, the risk reading, the pages and the queue with it.
 *
 * Dependency direction is one-way: this module reads projects, content,
 * technical and competitors. None of those read back at the data layer.
 */

export {
  BACKLINKS_AS_OF,
  BACKLINKS_RANGE,
  backlinksForContent,
  backlinksForProject,
  domainsForProject,
  getBacklink,
  getBacklinks,
  getReferringDomain,
  getReferringDomains,
} from "@/lib/mock/backlinks/registry";

export {
  getAllLinkedPages,
  getAnchorProfile,
  getLinkedPages,
  getRiskSummary,
  getVelocity,
} from "@/lib/mock/backlinks/profile";

export { getLinkGaps, linkGapsForProject } from "@/lib/mock/backlinks/gaps";

export {
  getOutreachOpportunities,
  outreachForProject,
} from "@/lib/mock/backlinks/opportunities";

export {
  ANCHOR_META,
  ANCHOR_ORDER,
  CATEGORY_META,
  CATEGORY_ORDER,
  EFFORT_META,
  LINK_KIND_META,
  LINK_KIND_ORDER,
  LINK_REL_META,
  LINK_REL_ORDER,
  LINK_SOURCE_NOTE,
  LINK_SOURCE_SHORT,
  LINK_STATUS_META,
  LINK_STATUS_ORDER,
  OUTREACH_KIND_META,
  OUTREACH_KIND_ORDER,
  OUTREACH_STAGE_CYCLE,
  OUTREACH_STAGE_META,
  OUTREACH_STAGE_ORDER,
  PLACEMENT_META,
  PLACEMENT_ORDER,
  PLACEMENT_VALUE,
  PROVENANCE_META,
  QUALITY_META,
  QUALITY_ORDER,
  RELATIONSHIP_META,
  RELATIONSHIP_ORDER,
  RELEVANCE_META,
  RELEVANCE_ORDER,
  SEVERITY_META,
  SEVERITY_ORDER,
  TOXIC_ACTION_META,
  TOXIC_SIGNAL_META,
  TOXIC_SIGNAL_ORDER,
} from "@/lib/mock/backlinks/meta";

export {
  ANCHOR_CEILING,
  EFFORT_ORDER,
  QUALITY_FLOORS,
  SEVERITY_RANK,
  TOXIC_HARMFUL,
  TOXIC_REVIEW,
  qualityBandFor,
  relevanceBandFor,
} from "@/lib/mock/backlinks/scoring";

export const BACKLINKS_RANGE_CAPTION = BACKLINKS_RANGE.caption;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tally(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function distribution<T extends string>(
  order: readonly T[],
  counts: Record<string, number>,
  meta: Readonly<
    Record<T, { label: string; tone: LinkDistributionRow["tone"]; description: string }>
  >,
  total: number,
): readonly LinkDistributionRow[] {
  return order
    .filter((key) => (counts[key] ?? 0) > 0)
    .map((key) => ({
      id: key,
      label: meta[key].label,
      count: counts[key],
      share: ratio(counts[key], total),
      tone: meta[key].tone,
      description: meta[key].description,
    }));
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Projects that have a link profile, for the project filter. */
export function getBacklinkProjectOptions(): readonly {
  readonly id: string;
  readonly name: string;
}[] {
  const seen = new Map<string, string>();
  for (const domain of getReferringDomains()) {
    if (!seen.has(domain.projectId)) {
      seen.set(domain.projectId, domain.projectName);
    }
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** Referring domains, for the domain filter. */
export function getDomainOptions(): readonly {
  readonly id: string;
  readonly label: string;
  readonly projectId: string;
}[] {
  return getReferringDomains().map((domain) => ({
    id: domain.id,
    label: `${domain.domain} · ${domain.projectName}`,
    projectId: domain.projectId,
  }));
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * The headline reading for a selection.
 *
 * One call, because every figure on the overview has to describe the same set
 * of links. Assembling them separately in the component is how a card ends up
 * counting a link the table below it has already filtered out.
 */
export function getAuthorityOverview(
  links: readonly Backlink[],
  domains: readonly ReferringDomain[],
  pages: readonly LinkedPage[],
  gaps: readonly LinkGap[],
  opportunities: readonly OutreachOpportunity[],
): AuthorityOverview {
  const anchors = getAnchorProfile(links);
  const velocity = getVelocity(links, domains);
  const risk = getRiskSummary(links, domains, anchors.score.score);

  const live = links.filter((link) => link.status !== "lost");
  const followed = live.filter((link) => link.rel === "follow").length;
  const referralTraffic = live.reduce(
    (carry, link) => carry + link.referralTraffic,
    0,
  );

  const authority = projectAuthority({
    domains: domains.length,
    meanQuality: mean(live.map((link) => link.quality.score)),
    followedShare: ratio(followed, Math.max(live.length, 1)),
    anchorHealth: anchors.score.score,
    toxicShare: risk.toxicShare,
    retention: velocity.retention,
  });

  const linkedPages = pages.filter((page) => page.referringDomains > 0);
  const unlinkedPages = pages.length - linkedPages.length;

  const metrics: readonly LinkMetric[] = [
    {
      id: "authority",
      label: "Authority score",
      value: String(authority.score),
      unit: "/ 100",
      detail: QUALITY_META[authority.band].description,
      icon: "backlinks",
      health:
        authority.band === "excellent" || authority.band === "strong"
          ? "positive"
          : authority.band === "average"
            ? "neutral"
            : "warning",
    },
    {
      id: "domains",
      label: "Referring domains",
      value: formatCompact(domains.length),
      detail: `${formatNumber(live.length)} live links across them.`,
      icon: "globe",
      health: "neutral",
    },
    {
      id: "followed",
      label: "Followed links",
      value: formatNumber(followed),
      unit: `of ${formatCompact(live.length)}`,
      detail: `${formatPercent(ratio(followed, Math.max(live.length, 1)), 0)} carry ranking signal.`,
      icon: "check",
      health:
        ratio(followed, Math.max(live.length, 1)) >= 60 ? "positive" : "warning",
    },
    {
      id: "new",
      label: "New links",
      value: formatNumber(velocity.newLinks),
      detail: "First seen inside the reporting window.",
      icon: "trend-up",
      health: velocity.newLinks > 0 ? "positive" : "neutral",
    },
    {
      id: "lost",
      label: "Lost links",
      value: formatNumber(velocity.lostLinks),
      detail: velocity.summary,
      icon: "trend-down",
      health: velocity.net >= 0 ? "neutral" : "negative",
    },
    {
      id: "flagged",
      label: "Flagged links",
      value: formatNumber(risk.flaggedLinks),
      detail: `${risk.disavowCandidates} bad enough to disavow.`,
      icon: "shield",
      health: risk.disavowCandidates === 0 ? "positive" : "negative",
    },
    {
      id: "anchors",
      label: "Anchor health",
      value: String(anchors.score.score),
      unit: "/ 100",
      detail: anchors.summary,
      icon: "target",
      health: anchors.overWeighted.length === 0 ? "positive" : "warning",
    },
    {
      id: "referral",
      label: "Referral traffic",
      value: formatCompact(referralTraffic),
      detail: "Modelled monthly sessions from these links.",
      icon: "analytics",
      health: "neutral",
    },
    {
      id: "linked-pages",
      label: "Pages earning links",
      value: formatNumber(linkedPages.length),
      unit: `of ${formatCompact(pages.length)}`,
      detail: `${unlinkedPages} published pages have earned nothing.`,
      icon: "pages",
      health: unlinkedPages === 0 ? "positive" : "warning",
    },
    {
      id: "gaps",
      label: "Competitor gaps",
      value: formatNumber(gaps.length),
      detail: "Domains linking to a rival and not to us.",
      icon: "competitors",
      health: gaps.length === 0 ? "positive" : "warning",
    },
    {
      id: "jobs",
      label: "Authority jobs",
      value: formatNumber(opportunities.length),
      detail: `${opportunities.filter((entry) => entry.severity === "critical" || entry.severity === "high").length} at critical or high severity.`,
      icon: "bolt",
      health: "neutral",
    },
    {
      id: "toxic",
      label: "Profile risk",
      value: formatPercent(risk.toxicShare, 0),
      detail: "Share of the profile carrying any risk signal.",
      icon: "alert",
      health: risk.toxicShare < 8 ? "positive" : "warning",
    },
  ];

  return {
    authority,
    metrics,
    velocity,
    risk,
    anchors,
    quality: distribution(
      QUALITY_ORDER,
      tally(live.map((link) => link.band)),
      QUALITY_META,
      live.length,
    ),
    categories: distribution(
      CATEGORY_ORDER,
      tally(domains.map((domain) => domain.category)),
      // Category metadata carries an icon rather than a tone, so the rows are
      // given a neutral tone here rather than the vocabulary inventing one.
      Object.fromEntries(
        CATEGORY_ORDER.map((key) => [
          key,
          {
            label: CATEGORY_META[key].label,
            tone: "neutral" as const,
            description: CATEGORY_META[key].description,
          },
        ]),
      ) as Readonly<
        Record<
          (typeof CATEGORY_ORDER)[number],
          { label: string; tone: LinkDistributionRow["tone"]; description: string }
        >
      >,
      domains.length,
    ),
    relevance: distribution(
      RELEVANCE_ORDER,
      tally(domains.map((domain) => domain.relevanceBand)),
      RELEVANCE_META,
      domains.length,
    ),
    topDomains: [...domains]
      .sort(
        (a, b) =>
          b.quality.score - a.quality.score || a.id.localeCompare(b.id),
      )
      .slice(0, 8),
    topPages: [...linkedPages]
      .sort(
        (a, b) =>
          b.pageAuthority.score - a.pageAuthority.score ||
          a.contentId.localeCompare(b.contentId),
      )
      .slice(0, 8),
    topOpportunities: opportunities.slice(0, 6),
    topGaps: [...gaps].sort((a, b) => b.value - a.value).slice(0, 6),
  };
}

// ---------------------------------------------------------------------------
// Integration readers
// ---------------------------------------------------------------------------

/**
 * The counts other modules show.
 *
 * Read from the same registry the workspace reads, so a figure quoted on the
 * Command Center and the same figure inside this module are one reading rather
 * than two. `"portfolio"` means every project.
 */
export type AuthoritySnapshotCounts = {
  readonly domains: number;
  readonly links: number;
  readonly authority: number;
  readonly band: ReferringDomain["band"];
  readonly newLinks: number;
  readonly lostLinks: number;
  readonly net: number;
  readonly followedShare: number;
  readonly flaggedLinks: number;
  readonly disavowCandidates: number;
  readonly anchorHealth: number;
  readonly gaps: number;
  readonly opportunities: number;
  readonly highPriority: number;
  readonly referralTraffic: number;
  readonly topOpportunity: OutreachOpportunity | null;
};

export function getAuthoritySnapshotCounts(
  projectId: string,
): AuthoritySnapshotCounts {
  const links =
    projectId === "portfolio" ? getBacklinks() : backlinksForProject(projectId);
  const domains =
    projectId === "portfolio"
      ? getReferringDomains()
      : domainsForProject(projectId);
  const gaps =
    projectId === "portfolio" ? getLinkGaps() : linkGapsForProject(projectId);
  const opportunities =
    projectId === "portfolio"
      ? getOutreachOpportunities()
      : outreachForProject(projectId);

  const pages = getAllLinkedPages(getBacklinks()).filter(
    (page) => projectId === "portfolio" || page.projectId === projectId,
  );

  const overview = getAuthorityOverview(
    links,
    domains,
    pages,
    gaps,
    opportunities,
  );

  const live = links.filter((link) => link.status !== "lost");
  const followed = live.filter((link) => link.rel === "follow").length;

  return {
    domains: domains.length,
    links: live.length,
    authority: overview.authority.score,
    band: overview.authority.band,
    newLinks: overview.velocity.newLinks,
    lostLinks: overview.velocity.lostLinks,
    net: overview.velocity.net,
    followedShare: ratio(followed, Math.max(live.length, 1)),
    flaggedLinks: overview.risk.flaggedLinks,
    disavowCandidates: overview.risk.disavowCandidates,
    anchorHealth: overview.anchors.score.score,
    gaps: gaps.length,
    opportunities: opportunities.length,
    highPriority: opportunities.filter(
      (entry) => entry.severity === "critical" || entry.severity === "high",
    ).length,
    referralTraffic: live.reduce(
      (carry, link) => carry + link.referralTraffic,
      0,
    ),
    topOpportunity: opportunities[0] ?? null,
  };
}

/** The link profile for one of our pages, for Content Studio. */
export function getPageLinkProfile(contentId: string): LinkedPage | null {
  return (
    getAllLinkedPages(getBacklinks()).find(
      (page) => page.contentId === contentId,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Development inspector
// ---------------------------------------------------------------------------

/**
 * Counts and an integrity pass, for `/dev/data`.
 *
 * Every finding the pass can return is a way this modelled layer could
 * contradict the canonical layers it hangs off, or could describe a link graph
 * that could not exist. An empty list is the passing result.
 */
export function getBacklinkDatasetCounts(): BacklinkDatasetCounts {
  const domains = getReferringDomains();
  const links = getBacklinks();
  const pages = getAllLinkedPages(links);
  const gaps = getLinkGaps();
  const opportunities = getOutreachOpportunities();

  const domainIds = new Set(domains.map((domain) => domain.id));
  const linkIds = new Set(links.map((link) => link.id));
  const contentIds = new Set(pages.map((page) => page.contentId));
  const projectIds = new Set(domains.map((domain) => domain.projectId));
  const integrity: string[] = [];

  const note = (condition: boolean, message: string) => {
    if (condition) integrity.push(message);
  };

  note(domainIds.size !== domains.length, "Duplicate referring-domain ids");
  note(linkIds.size !== links.length, "Duplicate backlink ids");
  note(
    new Set(gaps.map((gap) => gap.id)).size !== gaps.length,
    "Duplicate link-gap ids",
  );
  note(
    new Set(opportunities.map((entry) => entry.id)).size !== opportunities.length,
    "Duplicate opportunity ids",
  );
  note(
    new Set(pages.map((page) => page.contentId)).size !== pages.length,
    "Duplicate linked-page records",
  );

  // A domain name must be unique within a project; two projects may legitimately
  // both be linked from the same site.
  const scopedDomains = new Set(
    domains.map((domain) => `${domain.projectId}::${domain.domain}`),
  );
  note(
    scopedDomains.size !== domains.length,
    "Duplicate referring domain within a project",
  );

  // -- referential integrity --------------------------------------------
  note(
    links.some((link) => !domainIds.has(link.domainId)),
    "Backlink references a referring domain that does not exist",
  );
  note(
    links.some((link) => !contentIds.has(link.contentId)),
    "Backlink targets a page outside the canonical content inventory",
  );
  note(
    domains.some((domain) => domain.linkIds.some((id) => !linkIds.has(id))),
    "Referring domain lists a link that does not exist",
  );
  note(
    opportunities.some((entry) =>
      entry.linkIds.some((id) => !linkIds.has(id)),
    ),
    "Opportunity references a link that does not exist",
  );
  note(
    opportunities.some(
      (entry) => entry.contentId !== null && !contentIds.has(entry.contentId),
    ),
    "Opportunity references a page that does not exist",
  );
  note(
    gaps.some((gap) => !projectIds.has(gap.projectId)),
    "Link gap references an unknown project",
  );

  // -- project scope ----------------------------------------------------
  const domainProject = new Map(
    domains.map((domain) => [domain.id, domain.projectId]),
  );
  note(
    links.some((link) => domainProject.get(link.domainId) !== link.projectId),
    "Backlink and its referring domain disagree about the project",
  );
  const linkProject = new Map(links.map((link) => [link.id, link.projectId]));
  note(
    opportunities.some((entry) =>
      entry.linkIds.some((id) => linkProject.get(id) !== entry.projectId),
    ),
    "Opportunity spans more than one project",
  );

  // -- a link graph that could exist ------------------------------------
  note(
    domains.some((domain) => domain.linkCount !== domain.linkIds.length),
    "A domain's link count disagrees with its own link list",
  );
  note(
    domains.some((domain) => domain.followedLinks > domain.linkCount),
    "A domain reports more followed links than it has",
  );
  note(
    domains.some((domain) => domain.linkCount === 0),
    "A referring domain with no links",
  );
  note(
    links.some((link) => link.status === "lost" && link.lostAt === null),
    "A lost link with no date it was lost",
  );
  note(
    links.some((link) => link.status !== "lost" && link.lostAt !== null),
    "A live link carrying a lost date",
  );
  note(
    links.some((link) => link.status === "lost" && link.referralTraffic > 0),
    "A lost link still reporting referral traffic",
  );
  // A gap is a domain that does not link to us. If one appears in the
  // registry too, the two datasets contradict each other.
  const ourDomains = new Set(
    domains.map((domain) => `${domain.projectId}::${domain.domain}`),
  );
  note(
    gaps.some((gap) => ourDomains.has(`${gap.projectId}::${gap.domain}`)),
    "A competitor gap names a domain that already links to us",
  );

  // -- scores stay in band ----------------------------------------------
  const inBand = (value: number) => value >= 0 && value <= 100;
  note(
    links.some(
      (link) =>
        !inBand(link.quality.score) ||
        !inBand(link.toxicScore) ||
        !inBand(link.domainAuthority),
    ),
    "A link score falls outside 0-100",
  );
  note(
    domains.some(
      (domain) =>
        !inBand(domain.quality.score) ||
        !inBand(domain.authority) ||
        !inBand(domain.relevance),
    ),
    "A domain score falls outside 0-100",
  );
  note(
    opportunities.some(
      (entry) => !inBand(entry.priority) || !inBand(entry.value),
    ),
    "An opportunity score falls outside 0-100",
  );

  // -- aggregates reconcile ---------------------------------------------
  const misreconciled = links.filter((link) => {
    const sum = link.quality.factors.reduce(
      (carry, factor) => carry + factor.value * factor.weight,
      0,
    );
    return Math.abs(Math.round(sum) - link.quality.score) > 1;
  }).length;
  note(
    misreconciled > 0,
    `${misreconciled} link scores do not reconcile with their own factors`,
  );

  // -- claims the product has no right to make --------------------------
  note(
    links.some((link) => link.provenance !== "modelled"),
    "A backlink is not labelled modelled",
  );
  note(
    domains.some((domain) => !domain.domain.endsWith(".example")),
    "A referring domain is not on the reserved demo TLD",
  );

  // -- degenerate data --------------------------------------------------
  const distinctQualityScores = new Set(
    links.map((link) => link.quality.score),
  ).size;
  note(
    links.length > 50 && distinctQualityScores < 20,
    `Only ${distinctQualityScores} distinct link quality scores across ${links.length} links`,
  );
  note(
    new Set(domains.map((domain) => domain.authority)).size < 20,
    "Domain authorities are too uniform to rank",
  );
  note(
    opportunities.length > 5 &&
      new Set(opportunities.map((entry) => entry.priority)).size < 4,
    "Opportunity priorities are too uniform to rank",
  );

  return {
    domains: domains.length,
    links: links.length,
    pages: pages.length,
    gaps: gaps.length,
    opportunities: opportunities.length,
    projects: projectIds.size,
    byStatus: tally(links.map((link) => link.status)),
    byKind: tally(links.map((link) => link.kind)),
    byRel: tally(links.map((link) => link.rel)),
    byAnchorKind: tally(links.map((link) => link.anchorKind)),
    byBand: tally(links.map((link) => link.band)),
    byCategory: tally(domains.map((domain) => domain.category)),
    byRelevance: tally(domains.map((domain) => domain.relevanceBand)),
    byRelationship: tally(domains.map((domain) => domain.relationship)),
    byPlacement: tally(links.map((link) => link.placement)),
    byToxicSignal: tally(links.flatMap((link) => link.toxicSignals)),
    byOutreachKind: tally(opportunities.map((entry) => entry.kind)),
    distinctQualityScores,
    integrity,
  };
}
