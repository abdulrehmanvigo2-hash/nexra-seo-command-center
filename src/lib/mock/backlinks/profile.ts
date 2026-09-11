import { round } from "@/lib/mock/dashboard/core";
import { getContentRecords } from "@/lib/mock/content";
import {
  ANCHOR_META,
  ANCHOR_ORDER,
  TOXIC_SIGNAL_META,
} from "@/lib/mock/backlinks/meta";
import {
  ANCHOR_CEILING,
  TOXIC_HARMFUL,
  TOXIC_REVIEW,
  anchorHealthScore,
  assemble,
  mean,
  pageAuthority,
  ratio,
  riskScore,
} from "@/lib/mock/backlinks/scoring";
import type {
  AnchorKind,
  AnchorProfile,
  AnchorRow,
  Backlink,
  LinkDistributionRow,
  LinkVelocity,
  LinkedPage,
  ReferringDomain,
  RiskSummary,
} from "@/types/backlinks";

/**
 * Readings over a selection of links and domains.
 *
 * Everything here takes the selection as an argument rather than reaching for
 * the whole graph, so narrowing to one project narrows the authority score,
 * the anchor profile, the risk reading and the page list with it — and each
 * panel says which set it is describing.
 */

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

/**
 * How natural the anchor distribution reads.
 *
 * Computed over *followed* links only, and deliberately so: a nofollowed
 * exact-match anchor is not the signal the check is looking for, and counting
 * it would report manipulation where there is none.
 */
export function getAnchorProfile(links: readonly Backlink[]): AnchorProfile {
  const followed = links.filter(
    (link) => link.rel === "follow" && link.status !== "lost",
  );

  const shares = {} as Record<AnchorKind, number>;
  const rows: AnchorRow[] = [];

  for (const kind of ANCHOR_ORDER) {
    const matching = followed.filter((link) => link.anchorKind === kind);
    const share = ratio(matching.length, Math.max(followed.length, 1));
    shares[kind] = share;

    if (matching.length === 0) continue;

    // The most common actual anchors of this kind, so a reader can see what
    // the classification is actually made of.
    const counts = new Map<string, number>();
    for (const link of matching) {
      counts.set(link.anchorText, (counts.get(link.anchorText) ?? 0) + 1);
    }
    const examples = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([text]) => text);

    const overWeighted = share > ANCHOR_CEILING[kind];

    rows.push({
      kind,
      label: ANCHOR_META[kind].label,
      links: matching.length,
      share,
      ceiling: ANCHOR_CEILING[kind],
      overWeighted,
      examples,
      tone: overWeighted ? "critical" : ANCHOR_META[kind].tone,
      description: ANCHOR_META[kind].description,
    });
  }

  const health = anchorHealthScore(shares);
  const over = rows.filter((row) => row.overWeighted).map((row) => row.kind);

  const score = assemble(
    [
      {
        id: "distribution",
        label: "Within natural ceilings",
        value: health,
        weight: 0.62,
        provenance: "derived",
        detail:
          over.length === 0
            ? "No anchor kind is past the share a natural profile would carry."
            : `${over.length} anchor ${over.length === 1 ? "kind is" : "kinds are"} past the ceiling.`,
      },
      {
        id: "branded",
        label: "Branded share",
        value: Math.min((shares.branded ?? 0) * 2.4, 100),
        weight: 0.24,
        provenance: "derived",
        detail: `${shares.branded ?? 0}% of followed links use the brand name — what an earned profile is mostly made of.`,
      },
      {
        id: "exact",
        label: "Exact-match restraint",
        value: Math.max(
          0,
          100 - (shares["exact-match"] ?? 0) * (100 / ANCHOR_CEILING["exact-match"]),
        ),
        weight: 0.14,
        provenance: "derived",
        detail: `${shares["exact-match"] ?? 0}% exact-match, against a ${ANCHOR_CEILING["exact-match"]}% ceiling.`,
      },
    ],
    0,
    (value) =>
      over.length === 0
        ? `${value} out of 100: the profile reads as earned.`
        : `${value} out of 100, pulled down by ${over.join(" and ")}.`,
  );

  return {
    rows: rows.sort((a, b) => b.links - a.links || a.kind.localeCompare(b.kind)),
    followedLinks: followed.length,
    score,
    overWeighted: over,
    summary:
      followed.length === 0
        ? "No followed links in this selection to read an anchor profile from."
        : over.length === 0
          ? `${followed.length} followed links, with no anchor kind past its natural ceiling.`
          : `${followed.length} followed links, with ${over.map((kind) => ANCHOR_META[kind].label.toLowerCase()).join(" and ")} over-weighted.`,
  };
}

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

/**
 * What was gained and what was lost.
 *
 * Shown as a pair rather than a single net figure, which is the convention the
 * Command Center panel already set: a net of zero can mean nothing happened or
 * that forty links were won and forty lost, and those are different months.
 */
export function getVelocity(
  links: readonly Backlink[],
  domains: readonly ReferringDomain[],
): LinkVelocity {
  const newLinks = links.filter((link) => link.status === "new").length;
  const lostLinks = links.filter((link) => link.status === "lost").length;

  const newDomains = domains.filter((domain) =>
    domain.linkIds.every((id) =>
      links.some((link) => link.id === id && link.status === "new"),
    ),
  ).length;
  const lostDomains = domains.filter(
    (domain) => domain.relationship === "lapsed",
  ).length;

  const gained = newLinks + links.filter((link) => link.status === "live").length;
  const retention = ratio(gained - lostLinks, Math.max(gained, 1));
  const net = newLinks - lostLinks;

  return {
    newLinks,
    lostLinks,
    net,
    newDomains,
    lostDomains,
    retention,
    summary:
      net > 0
        ? `${newLinks} won against ${lostLinks} lost — the profile is growing.`
        : net < 0
          ? `${lostLinks} lost against ${newLinks} won — the profile is shrinking.`
          : `${newLinks} won and ${lostLinks} lost. Flat, not quiet.`,
  };
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export function getRiskSummary(
  links: readonly Backlink[],
  domains: readonly ReferringDomain[],
  anchorHealth: number,
): RiskSummary {
  const flaggedLinks = links.filter((link) => link.toxicSignals.length > 0);
  const disavow = links.filter((link) => link.toxicScore >= TOXIC_HARMFUL);
  const review = links.filter(
    (link) => link.toxicScore >= TOXIC_REVIEW && link.toxicScore < TOXIC_HARMFUL,
  );
  const removal = links.filter((link) =>
    link.toxicSignals.some(
      (signal) => TOXIC_SIGNAL_META[signal].action === "request-removal",
    ),
  );

  const counts = new Map<string, number>();
  for (const link of links) {
    for (const signal of link.toxicSignals) {
      counts.set(signal, (counts.get(signal) ?? 0) + 1);
    }
  }

  const signals: LinkDistributionRow[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([signal, count]) => {
      const meta = TOXIC_SIGNAL_META[signal as keyof typeof TOXIC_SIGNAL_META];
      return {
        id: signal,
        label: meta.label,
        count,
        share: ratio(count, Math.max(links.length, 1)),
        tone:
          meta.severity === "critical" || meta.severity === "high"
            ? ("critical" as const)
            : meta.severity === "medium"
              ? ("warning" as const)
              : ("neutral" as const),
        description: meta.description,
      };
    });

  return {
    flaggedLinks: flaggedLinks.length,
    flaggedDomains: domains.filter((domain) => domain.toxicSignals.length > 0)
      .length,
    disavowCandidates: disavow.length,
    removalCandidates: removal.length,
    reviewCandidates: review.length,
    toxicShare: ratio(flaggedLinks.length, Math.max(links.length, 1)),
    score: riskScore({
      links: links.length,
      flagged: flaggedLinks.length,
      disavow: disavow.length,
      anchorHealth,
    }),
    signals,
  };
}

// ---------------------------------------------------------------------------
// Link-earning pages
// ---------------------------------------------------------------------------

let pageCache: readonly LinkedPage[] | null = null;

/**
 * Our pages, read for the links they have earned.
 *
 * Built from the canonical content inventory rather than from the link graph,
 * so a page that has earned nothing still appears — a published page with no
 * links is one of the findings this module exists to surface, and a list
 * assembled from links alone would silently omit it.
 */
function buildPages(links: readonly Backlink[]): readonly LinkedPage[] {
  const byContent = new Map<string, Backlink[]>();
  for (const link of links) {
    const bucket = byContent.get(link.contentId);
    if (bucket) bucket.push(link);
    else byContent.set(link.contentId, [link]);
  }

  return getContentRecords()
    .filter((record) => record.url !== null)
    .map((record) => {
      const mine = byContent.get(record.id) ?? [];
      const live = mine.filter((link) => link.status !== "lost");
      const domains = new Set(live.map((link) => link.domainId));
      const followed = live.filter((link) => link.rel === "follow").length;
      const meanAuthority = Math.round(
        mean(live.map((link) => link.domainAuthority)),
      );

      const authority = pageAuthority({
        links: live.length,
        domains: domains.size,
        meanAuthority,
        followedShare: ratio(followed, Math.max(live.length, 1)),
        internalLinksIn: record.internalLinksIn,
      });

      return {
        contentId: record.id,
        title: record.title,
        path: (record.url as string).replace(/^https?:\/\/[^/]+/, ""),
        projectId: record.projectId,
        projectName: record.projectName,
        clusterId: record.clusterId,
        clusterName: record.clusterName,
        links: live.length,
        referringDomains: domains.size,
        followedLinks: followed,
        lostLinks: mine.filter((link) => link.status === "lost").length,
        averageAuthority: meanAuthority,
        pageAuthority: authority,
        referralTraffic: live.reduce(
          (carry, link) => carry + link.referralTraffic,
          0,
        ),
        internalLinksIn: record.internalLinksIn,
        // A page that has earned external authority and passes almost none of
        // it on internally is wasting the link. That is a content-strategy
        // job, not an outreach one, and the queue treats it that way.
        underLinkedInternally: domains.size >= 5 && record.internalLinksOut <= 1,
      } satisfies LinkedPage;
    });
}

export function getLinkedPages(
  links: readonly Backlink[],
): readonly LinkedPage[] {
  // The full-graph result is memoised because every project view reads it;
  // a narrowed selection is cheap enough to build on demand.
  if (links.length === 0) return [];
  return buildPages(links);
}

/** The whole inventory, memoised. */
export function getAllLinkedPages(
  links: readonly Backlink[],
): readonly LinkedPage[] {
  pageCache ??= buildPages(links);
  return pageCache;
}

export { round };
