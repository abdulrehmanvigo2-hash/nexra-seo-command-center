import { clamp } from "@/lib/mock/dashboard/core";
import { getKeywordRecord } from "@/lib/mock/keywords";
import { LINK_KIND_ORDER } from "@/lib/mock/content/meta";
import { getContentRecords } from "@/lib/mock/content/records";
import type { ContentRecord, InternalLinkOpportunity } from "@/types/content";

/**
 * Links that should exist and do not.
 *
 * The graph of links that *do* exist is built with the records themselves, so
 * this file is a reading of that graph rather than a second opinion about it:
 * an opportunity is only listed where the edge is genuinely absent, and the
 * inbound count on a page and the orphan findings here can never disagree.
 *
 * Five kinds, in the order a strategist would act on them. A page splitting
 * clicks with another of ours is the most urgent, because the fix changes
 * which page ranks at all. A page nothing links to is next, because nothing
 * flows into it. After that the cluster structure — supporting pages pointing
 * at their pillar — then authority passed from strong pages to weak ones, then
 * the ordinary sibling links that make a topic read as one thing.
 *
 * Anchor text is the target page's own primary keyword, never invented: an
 * anchor that does not match what the target is trying to rank for is not a
 * useful suggestion.
 */

/**
 * The site root.
 *
 * Site navigation links to the homepage from every page, so it can never be
 * orphaned in the way a buried guide can. The link graph models contextual
 * links rather than navigation, which would otherwise report the one page on
 * the site guaranteed to have inbound links as having none.
 */
function isSiteRoot(record: ContentRecord): boolean {
  return record.url === "/";
}

/** Anchor text for a link into a page. */
function anchorFor(target: ContentRecord): string {
  return target.primaryKeyword ?? target.title.toLowerCase();
}

function opportunity(input: {
  readonly kind: InternalLinkOpportunity["kind"];
  readonly from: ContentRecord;
  readonly to: ContentRecord;
  readonly reason: string;
  readonly strength: number;
  readonly owner: InternalLinkOpportunity["owner"];
  readonly suffix?: string;
}): InternalLinkOpportunity {
  const { kind, from, to } = input;

  return {
    id: `${kind}--${from.id}--${to.id}${input.suffix ?? ""}`,
    kind,
    fromId: from.id,
    fromTitle: from.title,
    fromUrl: from.url as string,
    toId: to.id,
    toTitle: to.title,
    toUrl: to.url,
    anchor: anchorFor(to),
    reason: input.reason,
    strength: Math.round(clamp(input.strength, 1, 100)),
    projectId: from.projectId,
    projectName: from.projectName,
    owner: input.owner,
  };
}

function build(): readonly InternalLinkOpportunity[] {
  const records = getContentRecords();
  const byId = new Map(records.map((record) => [record.id, record]));
  const live = records.filter((record) => record.url !== null);

  const byCluster = new Map<string, ContentRecord[]>();
  for (const record of live) {
    const bucket = byCluster.get(record.clusterId);
    if (bucket) bucket.push(record);
    else byCluster.set(record.clusterId, [record]);
  }

  const results: InternalLinkOpportunity[] = [];
  const linksFrom = (record: ContentRecord, targetId: string) =>
    record.linksTo.includes(targetId);

  // 1. Cannibalisation. A page ranking for somebody else's target should point
  //    at the page that is meant to own it, with that term as the anchor.
  for (const competing of live) {
    for (const keywordId of competing.unintendedKeywordIds) {
      const intended = live.find((record) =>
        record.keywordIds.includes(keywordId),
      );
      if (!intended || intended.id === competing.id) continue;
      if (linksFrom(competing, intended.id)) continue;

      const keyword = getKeywordRecord(keywordId);

      results.push(
        opportunity({
          kind: "cannibalisation-fix",
          from: competing,
          to: intended,
          reason: `Both pages rank for “${keyword?.keyword ?? anchorFor(intended)}”. Pointing this one at the intended page consolidates the signal instead of splitting it.`,
          strength: 92,
          owner: "on-page-seo",
          suffix: `--${keywordId}`,
        }),
      );
    }
  }

  // 2. Orphans. Nothing links in, so nothing flows in.
  for (const orphan of live) {
    if (orphan.internalLinksIn > 0 || isSiteRoot(orphan)) continue;

    const siblings = (byCluster.get(orphan.clusterId) ?? []).filter(
      (record) => record.id !== orphan.id,
    );
    const source =
      siblings.find((record) => record.role === "pillar") ??
      [...siblings].sort((a, b) => b.score.score - a.score.score)[0];

    if (!source) continue;

    results.push(
      opportunity({
        kind: "orphan-rescue",
        from: source,
        to: orphan,
        reason:
          "Nothing on the site links to this page, so it earns no internal authority at all.",
        strength: 84,
        owner: "content-strategist",
      }),
    );
  }

  // 3. Supporting pages that do not point at their pillar.
  for (const [, members] of byCluster) {
    const pillar = members.find((record) => record.role === "pillar");
    if (!pillar) continue;

    for (const supporting of members) {
      if (supporting.id === pillar.id) continue;
      if (linksFrom(supporting, pillar.id)) continue;

      results.push(
        opportunity({
          kind: "pillar-uplift",
          from: supporting,
          to: pillar,
          reason: `A supporting page in this cluster with no link up to the pillar. The cluster reads as separate pages rather than one topic.`,
          strength: 62 + Math.min(20, Math.round(supporting.totalVolume / 2_000)),
          owner: "content-strategist",
        }),
      );
    }
  }

  // 4. Authority flow: a page that is winning can lend to one that is stuck.
  for (const [, members] of byCluster) {
    const strong = members.filter(
      (record) =>
        record.score.score >= 70 &&
        record.bestPosition !== null &&
        record.bestPosition <= 5,
    );
    const stuck = members.filter(
      (record) =>
        record.bestPosition !== null &&
        record.bestPosition >= 11 &&
        record.bestPosition <= 35,
    );

    for (const source of strong) {
      for (const target of stuck) {
        if (source.id === target.id) continue;
        if (linksFrom(source, target.id)) continue;

        results.push(
          opportunity({
            kind: "authority-flow",
            from: source,
            to: target,
            reason: `${source.title} ranks at ${source.bestPosition} on its own terms. A contextual link would pass some of that to a page stuck at ${target.bestPosition}.`,
            strength: 70,
            owner: "on-page-seo",
          }),
        );
      }
    }
  }

  // 5. Ordinary sibling links, kept to the strongest pair per cluster so the
  //    list stays a set of decisions rather than every possible edge.
  for (const [, members] of byCluster) {
    const ranked = [...members].sort((a, b) => b.totalVolume - a.totalVolume);

    for (let index = 0; index < Math.min(2, ranked.length - 1); index += 1) {
      const from = ranked[index];
      const to = ranked[index + 1];
      if (!from || !to) continue;
      if (linksFrom(from, to.id) || linksFrom(to, from.id)) continue;
      if (from.role === "pillar" || to.role === "pillar") continue;

      results.push(
        opportunity({
          kind: "cluster-support",
          from,
          to,
          reason:
            "Two of the strongest pages on this topic with no link between them in either direction.",
          strength: 52,
          owner: "content-strategist",
        }),
      );
    }
  }

  // De-duplicate: a page can qualify for the same edge under two headings, and
  // the most urgent reading is the one worth acting on.
  const seen = new Set<string>();
  const deduped: InternalLinkOpportunity[] = [];

  for (const kind of LINK_KIND_ORDER) {
    for (const entry of results) {
      if (entry.kind !== kind) continue;
      const edge = `${entry.fromId}->${entry.toId}`;
      if (seen.has(edge)) continue;
      seen.add(edge);
      deduped.push(entry);
    }
  }

  // Keep the target resolvable — every id here came from the record set, but
  // the map read makes that a checked assumption rather than an assumed one.
  return deduped
    .filter((entry) => byId.has(entry.toId) && byId.has(entry.fromId))
    .sort(
      (a, b) =>
        LINK_KIND_ORDER.indexOf(a.kind) - LINK_KIND_ORDER.indexOf(b.kind) ||
        b.strength - a.strength ||
        a.fromTitle.localeCompare(b.fromTitle),
    );
}

let cache: readonly InternalLinkOpportunity[] | null = null;

/** Every internal-link opportunity across the inventory, most urgent first. */
export function getLinkOpportunities(): readonly InternalLinkOpportunity[] {
  cache ??= build();
  return cache;
}

/** Opportunities where this page is the one that should add the link. */
export function linksOutFor(
  contentId: string,
): readonly InternalLinkOpportunity[] {
  return getLinkOpportunities().filter((entry) => entry.fromId === contentId);
}

/** Opportunities where this page is the one that should receive the link. */
export function linksInFor(
  contentId: string,
): readonly InternalLinkOpportunity[] {
  return getLinkOpportunities().filter((entry) => entry.toId === contentId);
}

/** Pages nothing links to, worst first. */
export function getOrphanPages(): readonly ContentRecord[] {
  return getContentRecords()
    .filter(
      (record) =>
        record.url !== null &&
        record.internalLinksIn === 0 &&
        !isSiteRoot(record),
    )
    .sort((a, b) => b.totalVolume - a.totalVolume);
}
