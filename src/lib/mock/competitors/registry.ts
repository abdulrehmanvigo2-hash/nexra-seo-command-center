import { DATA_AS_OF, clamp, rand, randInt, round } from "@/lib/mock/dashboard/core";
import { PROJECTS } from "@/lib/mock/projects/roster";
import {
  KEYWORD_RANGE,
  slug,
  targetPositionFor,
} from "@/lib/mock/keywords/builders";
import {
  INTENT_ORDER,
  ctrAt,
  getCompetitorGaps,
  getKeywordClusters,
  getKeywordRecords,
  getRivalRankings,
} from "@/lib/mock/keywords";
import { contentForCluster, getContentRecords } from "@/lib/mock/content";
import { COMPETITOR_TYPE_ORDER } from "@/lib/mock/competitors/meta";
import {
  battleStateFor,
  clusterStrength,
  competitorOpportunity,
  competitorStrength,
  keywordOpportunity,
  pageStrength,
  pageThreat,
  positionScore,
  shareScore,
  threatLevelOf,
  threatScore,
} from "@/lib/mock/competitors/scoring";
import type { ContentRecord } from "@/types/content";
import type { KeywordCluster, KeywordRecord } from "@/types/keyword";
import type {
  BattleState,
  CompetitorPage,
  CompetitorRecord,
  CompetitorType,
  KeywordIntent,
  OverlapRow,
  RankingFootprint,
} from "@/types/competitor";

/**
 * The canonical competitor layer.
 *
 * Every competitor in this product is a rival the Command Center already
 * tracks for a project, seen through the keyword set the Keyword Intelligence
 * module already owns. Nothing here invents a brand, a domain, a keyword, or a
 * ranking:
 *
 * - **Who they are** — the project's rival set, read from the competitor gaps
 *   in `@/lib/mock/keywords`, which in turn reads the Command Center's own
 *   competitive set. One rival list in the product, not two.
 * - **Where they rank** — `getRivalRankings()`, the published form of the draw
 *   the keyword module already makes when it counts competitor gaps. That is
 *   why the overlap counts below and the Phase 5 gap figures agree by
 *   construction rather than by coincidence.
 * - **What we have against them** — our positions from the keyword records,
 *   our pages from the content inventory, our topic coverage from the cluster
 *   records.
 *
 * What this file adds is the competitor's own side of the picture, which no
 * earlier phase holds: the pages they rank with, how deep those pages run, and
 * the domain-level facts a fixture cannot observe. Those are seeded from the
 * domain and the project, so they are identical on every render and identical
 * for the same rival wherever it appears.
 *
 * A competitor record is scoped to one project. The same domain competing in
 * two of our clients' markets is two records, because the overlap, the
 * rankings, and the threat are different in each — averaging them would
 * produce a number that describes neither fight.
 */

/** The instant the module's figures are written against. */
export const COMPETITORS_AS_OF = DATA_AS_OF;

/** The window the figures are measured over — the keyword module's window. */
export const COMPETITOR_RANGE = KEYWORD_RANGE;

const CLOSE_CONTEST = 2;

// ---------------------------------------------------------------------------
// Seeded domain facts
// ---------------------------------------------------------------------------

/** Stable integer for a string, so a domain seeds the same values every time. */
function hashOf(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (Math.imul(value, 31) + text.charCodeAt(index)) | 0;
  }
  return Math.abs(value);
}

/**
 * What kind of business the rival is.
 *
 * Assigned by position in the sorted list of distinct rival domains rather
 * than by hashing one. There are only a handful of domains in the product, and
 * a hash over that few values leaves some kinds with no rival at all and piles
 * the rest onto one — a filter offering five kinds where two select nothing.
 * Cycling the list guarantees every kind is represented, and keying on the
 * sorted domain list keeps a rival the same kind of company in every market it
 * appears in.
 */
function typeFor(domain: string, domainOrder: readonly string[]): CompetitorType {
  const index = domainOrder.indexOf(domain);
  return COMPETITOR_TYPE_ORDER[
    (index < 0 ? hashOf(domain) : index) % COMPETITOR_TYPE_ORDER.length
  ];
}

/**
 * An authority-style score for the domain, 0-100.
 *
 * Seeded, and deliberately not called by any vendor's name: there is no link
 * index behind this product (CLAUDE.md §4). Stronger rivals — the ones earlier
 * in the project's set, which is ordered by visibility — carry more of it.
 */
function authorityFor(domain: string, rivalIndex: number): number {
  const base = 48 + (hashOf(domain) % 34);
  return Math.round(clamp(base - rivalIndex * 4.5, 22, 92));
}

/** Estimated monthly sessions a position earns on a keyword. */
function trafficAt(volume: number, position: number | null): number {
  return (volume * ctrAt(position)) / 100;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

/** First letter capitalised, nothing else touched. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Page titles
// ---------------------------------------------------------------------------

/**
 * What a rival calls the page that owns a topic.
 *
 * Built from the cluster's own authored name and the intent behind it, rather
 * than from a title generator: a cluster is already named in the product's
 * vocabulary, and reusing it keeps their page recognisably about the same
 * topic as ours.
 */
const HUB_SUFFIX: Record<KeywordIntent, string> = {
  informational: "The Complete Guide",
  commercial: "Compared and Reviewed",
  transactional: "Pricing and Plans",
  navigational: "Overview",
  local: "Find a Provider Near You",
  mixed: "Everything You Need to Know",
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

type Draft = {
  readonly competitorId: string;
  readonly projectId: string;
  readonly rivalIndex: number;
  readonly name: string;
  readonly domain: string;
  readonly rows: readonly OverlapRow[];
  readonly pages: readonly CompetitorPage[];
  readonly presence: readonly ClusterPresence[];
};

/** One competitor's footing inside one cluster. */
export type ClusterPresence = {
  readonly competitorId: string;
  readonly competitorName: string;
  readonly competitorDomain: string;
  readonly projectId: string;
  readonly clusterId: string;
  readonly keywords: number;
  readonly topTen: number;
  readonly averagePosition: number | null;
  readonly pages: number;
  /** 0-100, read the same way ours is. */
  readonly strength: number;
};

type Built = {
  readonly records: readonly CompetitorRecord[];
  readonly overlap: readonly OverlapRow[];
  readonly pages: readonly CompetitorPage[];
  readonly presence: readonly ClusterPresence[];
};

let cache: Built | null = null;

function built(): Built {
  cache ??= build();
  return cache;
}

function build(): Built {
  const keywords = getKeywordRecords();
  const clusters = getKeywordClusters();
  const gaps = getCompetitorGaps();

  /** Every distinct rival domain, so a kind can be assigned to each. */
  const domainOrder = [...new Set(gaps.map((gap) => gap.domain))].sort();

  const clusterById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const keywordById = new Map(keywords.map((record) => [record.id, record]));

  // Which page of ours serves which keyword, resolved once. Every rival in a
  // project asks the same question about the same keywords, and the content
  // inventory is a list rather than an index.
  const contentByKeyword = new Map<string, ContentRecord>();
  for (const record of getContentRecords()) {
    for (const keywordId of record.keywordIds) {
      if (!contentByKeyword.has(keywordId)) contentByKeyword.set(keywordId, record);
    }
  }

  // Positions, indexed once. The keyword module publishes them as a flat list;
  // every reading below is a lookup against this.
  const positionsFor = new Map<string, Map<string, number>>();
  for (const entry of getRivalRankings()) {
    const bucket = positionsFor.get(entry.competitorId);
    if (bucket) bucket.set(entry.keywordId, entry.position);
    else
      positionsFor.set(
        entry.competitorId,
        new Map([[entry.keywordId, entry.position]]),
      );
  }

  const keywordsByProject = new Map<string, KeywordRecord[]>();
  for (const record of keywords) {
    const bucket = keywordsByProject.get(record.projectId);
    if (bucket) bucket.push(record);
    else keywordsByProject.set(record.projectId, [record]);
  }

  const records: CompetitorRecord[] = [];
  const allRows: OverlapRow[] = [];
  const allPages: CompetitorPage[] = [];
  const allPresence: ClusterPresence[] = [];

  for (const project of PROJECTS) {
    const projectKeywords = keywordsByProject.get(project.id) ?? [];
    if (projectKeywords.length === 0) continue;

    const projectGaps = gaps.filter((gap) => gap.projectId === project.id);
    const drafts: Draft[] = [];

    for (const gap of projectGaps) {
      // `competitorId` from the keyword layer is `${projectId}--rival-${index}`.
      const rivalIndex = Number(gap.competitorId.split("rival-")[1] ?? 0);
      const competitorId = `${project.id}--${gap.domain.split(".")[0]}`;
      const positions =
        positionsFor.get(gap.competitorId) ?? new Map<string, number>();

      const seed = project.seed + hashOf(gap.domain) + rivalIndex * 97;

      const rows = buildRows({
        competitorId,
        competitorName: gap.name,
        competitorDomain: gap.domain,
        keywords: projectKeywords,
        positions,
        contentByKeyword,
      });

      const pages = buildPages({
        competitorId,
        competitorName: gap.name,
        domain: gap.domain,
        rows,
        clusterById,
        contentByKeyword,
        seed,
      });

      const presence = buildPresence({
        competitorId,
        competitorName: gap.name,
        competitorDomain: gap.domain,
        projectId: project.id,
        rows,
        pages,
        clusterById,
      });

      drafts.push({
        competitorId,
        projectId: project.id,
        rivalIndex,
        name: gap.name,
        domain: gap.domain,
        rows: attachPages(rows, pages),
        pages,
        presence,
      });
    }

    // Second pass: which rival leads which cluster can only be decided once
    // every rival in the project has been measured the same way.
    const leaderByCluster = new Map<string, string>();
    const strongestByCluster = new Map<string, number>();

    for (const draft of drafts) {
      for (const entry of draft.presence) {
        const best = strongestByCluster.get(entry.clusterId) ?? -1;
        if (entry.strength > best) {
          strongestByCluster.set(entry.clusterId, entry.strength);
          leaderByCluster.set(entry.clusterId, entry.competitorId);
        }
      }
    }

    for (const draft of drafts) {
      const gap = projectGaps.find(
        (entry) => entry.domain === draft.domain,
      );
      if (!gap) continue;

      records.push(
        assembleRecord({
          draft,
          gap,
          project,
          keywordById,
          domainOrder,
          dominated: draft.presence
            .filter(
              (entry) =>
                leaderByCluster.get(entry.clusterId) === draft.competitorId &&
                entry.strength >= 15,
            )
            .map((entry) => entry.clusterId),
          totalKeywords: projectKeywords.length,
        }),
      );

      allRows.push(...draft.rows);
      allPages.push(...draft.pages);
      allPresence.push(...draft.presence);
    }
  }

  return {
    records: records.sort(
      (a, b) =>
        a.projectName.localeCompare(b.projectName) ||
        b.threat.score - a.threat.score ||
        a.name.localeCompare(b.name),
    ),
    overlap: allRows,
    pages: allPages.sort((a, b) => b.threatScore - a.threatScore),
    presence: allPresence,
  };
}

// ---------------------------------------------------------------------------
// Overlap rows
// ---------------------------------------------------------------------------

/**
 * Every keyword either side ranks for, from one competitor's point of view.
 *
 * A keyword neither side ranks for is not overlap and is not listed — it is a
 * gap in the keyword plan, which the Keyword Intelligence module already
 * reports. Listing it here would pad the table with rows that say nothing
 * about this rival.
 */
function buildRows(input: {
  readonly competitorId: string;
  readonly competitorName: string;
  readonly competitorDomain: string;
  readonly keywords: readonly KeywordRecord[];
  readonly positions: ReadonlyMap<string, number>;
  readonly contentByKeyword: ReadonlyMap<string, ContentRecord>;
}): readonly OverlapRow[] {
  const rows: OverlapRow[] = [];

  for (const keyword of input.keywords) {
    const theirPosition = input.positions.get(keyword.id) ?? null;
    const ourPosition = keyword.position;

    if (theirPosition === null && ourPosition === null) continue;

    const overlap =
      theirPosition !== null && ourPosition !== null
        ? "shared"
        : theirPosition !== null
          ? "theirs-only"
          : "ours-only";

    // A keyword only we rank for has no battle to be in: nobody is contesting
    // it. Null rather than "dominant" — we may hold it at position 60 — which
    // keeps it out of every battle count without a consumer having to remember
    // to exclude it.
    const battle: BattleState | null =
      theirPosition === null
        ? null
        : battleStateFor(ourPosition, theirPosition);

    const ourContent = input.contentByKeyword.get(keyword.id) ?? null;

    rows.push({
      id: `${input.competitorId}--${keyword.id}`,
      competitorId: input.competitorId,
      competitorName: input.competitorName,
      competitorDomain: input.competitorDomain,

      keywordId: keyword.id,
      keyword: keyword.keyword,
      projectId: keyword.projectId,
      projectName: keyword.projectName,
      clusterId: keyword.clusterId,
      clusterName: keyword.clusterName,
      intent: keyword.intent,

      volume: keyword.volume,
      difficulty: keyword.difficulty,
      cpc: keyword.cpc,

      ourPosition,
      theirPosition,
      rankGap:
        theirPosition !== null && ourPosition !== null
          ? theirPosition - ourPosition
          : null,

      overlap,
      battle,

      ourUrl: keyword.targetUrl,
      ourContentId: ourContent?.id ?? null,
      theirPageId: null,
      theirUrl: null,

      trafficAtStake: Math.round(
        Math.max(
          0,
          trafficAt(keyword.volume, targetPositionFor(ourPosition)) -
            trafficAt(keyword.volume, ourPosition),
        ),
      ),
      opportunity: keywordOpportunity({
        volume: keyword.volume,
        difficulty: keyword.difficulty,
        commercialValue: keyword.commercialValue,
        battle,
        ourPosition,
        theirPosition,
      }),
      owner: keyword.owner,
    });
  }

  return rows;
}

/** Fills in which page of theirs ranks, once the pages have been modelled. */
function attachPages(
  rows: readonly OverlapRow[],
  pages: readonly CompetitorPage[],
): readonly OverlapRow[] {
  const pageByKeyword = new Map<string, CompetitorPage>();
  for (const page of pages) {
    for (const keywordId of page.keywordIds) pageByKeyword.set(keywordId, page);
  }

  return rows.map((row) => {
    const page = pageByKeyword.get(row.keywordId);
    if (!page) return row;
    return { ...row, theirPageId: page.id, theirUrl: page.url };
  });
}

// ---------------------------------------------------------------------------
// Competitor pages
// ---------------------------------------------------------------------------

/**
 * The pages a rival ranks with.
 *
 * Modelled, not crawled. Their ranking keywords are grouped by the cluster
 * those keywords belong to, and a cluster with more than a handful of terms is
 * split across several pages the way a real site would split it: a hub page
 * carrying the strongest terms and narrower pages beneath it. Which term lands
 * on which page is a seeded draw, so the split is the same on every render.
 */
function buildPages(input: {
  readonly competitorId: string;
  readonly competitorName: string;
  readonly domain: string;
  readonly rows: readonly OverlapRow[];
  readonly clusterById: ReadonlyMap<string, KeywordCluster>;
  readonly contentByKeyword: ReadonlyMap<string, ContentRecord>;
  readonly seed: number;
}): readonly CompetitorPage[] {
  const ranking = input.rows.filter((row) => row.theirPosition !== null);
  const byCluster = new Map<string, OverlapRow[]>();

  for (const row of ranking) {
    const bucket = byCluster.get(row.clusterId);
    if (bucket) bucket.push(row);
    else byCluster.set(row.clusterId, [row]);
  }

  const pages: CompetitorPage[] = [];

  for (const [clusterId, members] of byCluster) {
    const cluster = input.clusterById.get(clusterId);
    if (!cluster) continue;

    const ordered = [...members].sort(
      (a, b) =>
        b.volume - a.volume ||
        (a.theirPosition as number) - (b.theirPosition as number),
    );

    // A real site puts the strongest terms on one hub page and splits the rest
    // beneath it, rather than spreading them evenly: a rival taking four terms
    // in a topic is usually taking them with one page, and a split that thin
    // would never produce that finding.
    const pageCount = clamp(Math.ceil(ordered.length / 4), 1, 3);
    const buckets: OverlapRow[][] = Array.from(
      { length: pageCount },
      () => [],
    );

    // The strongest terms seed one page each, so no page starts empty; the
    // rest are drawn across them, weighted towards the hub.
    ordered.forEach((row, index) => {
      const draw = rand(input.seed + hashOf(clusterId), index);
      const target =
        index < pageCount
          ? index
          : draw < 0.45
            ? 0
            : randInt(input.seed + hashOf(clusterId), index, 0, pageCount - 1);
      buckets[target].push(row);
    });

    buckets.forEach((bucket, index) => {
      if (bucket.length === 0) return;

      const positions = bucket.map((row) => row.theirPosition as number);
      const bestPosition = Math.min(...positions);
      const averagePosition = round(mean(positions) ?? bestPosition, 1);
      const totalVolume = bucket.reduce((carry, row) => carry + row.volume, 0);
      const seed = input.seed + hashOf(clusterId) + index * 613;

      const lead = bucket[0];
      const isHub = index === 0;
      const path = isHub
        ? `/${slug(cluster.name)}`
        : `/${slug(cluster.name)}/${slug(lead.keyword)}`;

      const contentDepth = Math.round(
        clamp(
          34 +
            positionScore(averagePosition) * 0.42 +
            bucket.length * 4 +
            rand(seed, 21) * 18,
          20,
          97,
        ),
      );

      const wordCount =
        randInt(seed, 22, 520, 1_180) + bucket.length * randInt(seed, 23, 90, 260);

      const strength = pageStrength({
        bestPosition,
        averagePosition,
        keywordCount: bucket.length,
        totalVolume,
        contentDepth,
      });

      // What we have on the same topic: the page targeting their best term
      // where one exists, otherwise the cluster's own pillar.
      const ourContent =
        bucket
          .map((row) => input.contentByKeyword.get(row.keywordId) ?? null)
          .find((entry) => entry !== null) ??
        contentForCluster(clusterId).find(
          (entry) => entry.role === "pillar" && entry.url !== null,
        ) ??
        null;

      const ourPositions = bucket
        .map((row) => row.ourPosition)
        .filter((value): value is number => value !== null);
      const ourBestPosition =
        ourPositions.length === 0 ? null : Math.min(...ourPositions);

      const ourScore =
        ourContent && ourContent.url !== null ? ourContent.score.score : null;

      const threat = pageThreat({
        strength,
        averagePosition,
        ourBestPosition,
        ourScore,
        totalVolume,
      });

      pages.push({
        id: `${input.competitorId}--page-${slug(cluster.name)}-${index}`,
        competitorId: input.competitorId,
        competitorName: input.competitorName,
        domain: input.domain,
        url: `https://${input.domain}${path}`,
        title: isHub
          ? `${cluster.name} — ${HUB_SUFFIX[cluster.primaryIntent]}`
          : sentenceCase(lead.keyword),

        projectId: lead.projectId,
        projectName: lead.projectName,
        clusterId,
        clusterName: cluster.name,
        intent: dominantIntent(bucket.map((row) => row.intent)),

        keywordIds: bucket.map((row) => row.keywordId),
        keywordCount: bucket.length,
        topKeywords: [...bucket]
          .sort(
            (a, b) =>
              (a.theirPosition as number) - (b.theirPosition as number) ||
              b.volume - a.volume,
          )
          .slice(0, 5)
          .map((row) => ({
            id: row.keywordId,
            keyword: row.keyword,
            position: row.theirPosition as number,
            volume: row.volume,
            ourPosition: row.ourPosition,
          })),

        totalVolume,
        bestPosition,
        averagePosition,
        estimatedTraffic: Math.round(
          bucket.reduce(
            (carry, row) => carry + trafficAt(row.volume, row.theirPosition),
            0,
          ),
        ),
        wordCount,
        contentDepth,

        strength,
        threatScore: threat,
        threatLevel: threatLevelOf(threat),
        opportunity: Math.round(
          clamp(
            mean(bucket.map((row) => row.opportunity)) ?? 0,
            0,
            100,
          ),
        ),

        ourContentId: ourContent?.id ?? null,
        ourContentTitle: ourContent?.title ?? null,
        ourUrl: ourContent?.url ?? null,
        ourScore,

        response: responseFor({
          hasOurPage: ourContent !== null && ourContent.url !== null,
          ourBestPosition,
          bestPosition,
          keywordCount: bucket.length,
          clusterName: cluster.name,
        }),
        owner:
          ourContent === null || ourContent.url === null
            ? "content-strategist"
            : ourBestPosition !== null && ourBestPosition <= bestPosition
              ? "on-page-seo"
              : "writer",
      });
    });
  }

  return pages;
}

/** What to do about one page of theirs. */
function responseFor(input: {
  readonly hasOurPage: boolean;
  readonly ourBestPosition: number | null;
  readonly bestPosition: number;
  readonly keywordCount: number;
  readonly clusterName: string;
}): string {
  if (!input.hasOurPage) {
    return `Nothing of ours covers this. Brief a page for ${input.clusterName} before anything else on this rival.`;
  }
  if (input.ourBestPosition === null) {
    return "Our page exists but ranks for none of these terms — check what it is actually targeting before rewriting it.";
  }
  if (input.ourBestPosition <= input.bestPosition) {
    return "We are already ahead here. Keep the page current rather than rebuilding it.";
  }
  if (input.keywordCount >= 4) {
    return `One page of theirs is taking ${input.keywordCount} terms. Match its scope or split ours to cover each term properly.`;
  }
  return "Close the gap on-page: title, opening answer, and internal links from the cluster pillar.";
}

/** The intent most of a page's terms carry. */
function dominantIntent(intents: readonly KeywordIntent[]): KeywordIntent {
  const tally = new Map<KeywordIntent, number>();
  for (const intent of intents) {
    tally.set(intent, (tally.get(intent) ?? 0) + 1);
  }

  return (
    [...tally.entries()].sort(
      (a, b) =>
        b[1] - a[1] || INTENT_ORDER.indexOf(a[0]) - INTENT_ORDER.indexOf(b[0]),
    )[0]?.[0] ?? "informational"
  );
}

// ---------------------------------------------------------------------------
// Cluster presence
// ---------------------------------------------------------------------------

function buildPresence(input: {
  readonly competitorId: string;
  readonly competitorName: string;
  readonly competitorDomain: string;
  readonly projectId: string;
  readonly rows: readonly OverlapRow[];
  readonly pages: readonly CompetitorPage[];
  readonly clusterById: ReadonlyMap<string, KeywordCluster>;
}): readonly ClusterPresence[] {
  const byCluster = new Map<string, OverlapRow[]>();
  for (const row of input.rows) {
    if (row.theirPosition === null) continue;
    const bucket = byCluster.get(row.clusterId);
    if (bucket) bucket.push(row);
    else byCluster.set(row.clusterId, [row]);
  }

  const presence: ClusterPresence[] = [];

  for (const [clusterId, members] of byCluster) {
    const cluster = input.clusterById.get(clusterId);
    if (!cluster) continue;

    const positions = members.map((row) => row.theirPosition as number);
    const pages = input.pages.filter((page) => page.clusterId === clusterId);

    presence.push({
      competitorId: input.competitorId,
      competitorName: input.competitorName,
      competitorDomain: input.competitorDomain,
      projectId: input.projectId,
      clusterId,
      keywords: members.length,
      topTen: positions.filter((position) => position <= 10).length,
      averagePosition: round(mean(positions) ?? 0, 1),
      pages: pages.length,
      strength: clusterStrength({
        ranking: members.length,
        total: cluster.keywordCount,
        topTen: positions.filter((position) => position <= 10).length,
        averagePosition: mean(positions),
        pages: pages.length,
      }),
    });
  }

  return presence.sort((a, b) => b.strength - a.strength);
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

function assembleRecord(input: {
  readonly draft: Draft;
  readonly gap: ReturnType<typeof getCompetitorGaps>[number];
  readonly project: (typeof PROJECTS)[number];
  readonly keywordById: ReadonlyMap<string, KeywordRecord>;
  readonly domainOrder: readonly string[];
  readonly dominated: readonly string[];
  readonly totalKeywords: number;
}): CompetitorRecord {
  const { draft, gap, project } = input;

  const ranking = draft.rows.filter((row) => row.theirPosition !== null);
  const shared = draft.rows.filter((row) => row.overlap === "shared");
  const theirPositions = ranking.map((row) => row.theirPosition as number);

  const theirWins = shared.filter(
    (row) => (row.rankGap as number) < 0,
  ).length;
  const ourWins = shared.filter((row) => (row.rankGap as number) > 0).length;
  const closeContests = shared.filter(
    (row) => Math.abs(row.rankGap as number) <= CLOSE_CONTEST,
  ).length;

  const footprint: RankingFootprint = {
    topThree: theirPositions.filter((position) => position <= 3).length,
    topTen: theirPositions.filter(
      (position) => position > 3 && position <= 10,
    ).length,
    topTwenty: theirPositions.filter(
      (position) => position > 10 && position <= 20,
    ).length,
    beyond: theirPositions.filter((position) => position > 20).length,
  };

  const contentDepth = Math.round(
    mean(draft.pages.map((page) => page.contentDepth)) ?? 0,
  );
  const authority = authorityFor(draft.domain, draft.rivalIndex);

  // Their direction of travel, read from ours: where we are losing places on
  // the terms they hold, they are the ones gaining them.
  const contested = shared.filter((row) => (row.rankGap as number) < 0);
  const drift = mean(
    contested.map((row) => input.keywordById.get(row.keywordId)?.change ?? 0),
  );
  const momentum = round(clamp(-(drift ?? 0) * 1.15, -9, 9), 1);

  // What they take of the traffic the two of us earn on this set. A better
  // reading than the raw difference: a rival holding half of a small set can
  // cost more than one holding a sliver of a large one.
  const shareOfVoice = shareScore(
    gap.visibility,
    Math.max(gap.visibility + gap.ourVisibility, 0.1),
  );

  const strength = competitorStrength({
    footprintShare: shareScore(ranking.length, input.totalKeywords),
    averagePosition: mean(theirPositions),
    shareOfVoice,
    visibility: gap.visibility,
    contentDepth,
    authority,
    momentum,
    keywordFootprint: ranking.length,
    pageCount: draft.pages.length,
  });

  const attackableRows = shared.filter(
    (row) =>
      row.battle === "easy-win" ||
      row.battle === "close-race" ||
      row.battle === "attack",
  );
  const recoverableTraffic = [...attackableRows, ...draft.rows.filter((row) => row.battle === "absent")].reduce(
    (carry, row) => carry + row.trafficAtStake,
    0,
  );

  const pagesInPlace = new Set(
    draft.rows
      .filter((row) => row.ourContentId !== null)
      .map((row) => row.ourContentId as string),
  ).size;

  const threat = threatScore({
    winRate: shareScore(theirWins, Math.max(shared.length, 1)),
    shareOfVoice,
    strength: strength.score,
    clusterDominanceShare: shareScore(
      input.dominated.length,
      Math.max(draft.presence.length, 1),
    ),
    momentum,
    theirWins,
    sharedKeywords: shared.length,
    trafficGap: gap.trafficGap,
    dominatedClusters: input.dominated.length,
  });

  const opportunity = competitorOpportunity({
    attackableShare: shareScore(
      attackableRows.length,
      Math.max(shared.length, 1),
    ),
    recoverableShare: clamp(recoverableTraffic / 65, 0, 100),
    weakness: clamp(100 - strength.score, 0, 100),
    readiness: shareScore(pagesInPlace, Math.max(draft.presence.length * 2, 1)),
    attackable: attackableRows.length,
    recoverableTraffic,
    pagesInPlace,
    contestedClusters: draft.presence.length,
  });

  const clusterIds = [...draft.presence]
    .sort((a, b) => b.keywords - a.keywords)
    .map((entry) => entry.clusterId);

  const intentTally = new Map<KeywordIntent, number>();
  for (const row of ranking) {
    intentTally.set(row.intent, (intentTally.get(row.intent) ?? 0) + 1);
  }

  const level = threatLevelOf(threat.score);

  return {
    id: draft.competitorId,
    name: draft.name,
    domain: draft.domain,
    type: typeFor(draft.domain, input.domainOrder),

    projectId: project.id,
    projectName: project.name,
    ourDomain: project.domain,
    market: project.market,
    category: project.industry,

    rivalIndex: draft.rivalIndex,

    keywordFootprint: ranking.length,
    rankingFootprint: footprint,
    sharedKeywords: shared.length,
    competitorOnly: draft.rows.filter((row) => row.overlap === "theirs-only")
      .length,
    ourOnly: draft.rows.filter((row) => row.overlap === "ours-only").length,
    theirWins,
    ourWins,
    closeContests,
    visibility: gap.visibility,
    ourVisibility: gap.ourVisibility,
    visibilityGap: gap.visibilityGap,
    rankingGap: gap.rankingGap,
    averagePosition:
      theirPositions.length === 0 ? null : round(mean(theirPositions) ?? 0, 1),
    ourAveragePosition: round(
      mean(shared.map((row) => row.ourPosition as number)) ?? 0,
      1,
    ),
    trafficEstimate: Math.round(
      ranking.reduce(
        (carry, row) => carry + trafficAt(row.volume, row.theirPosition),
        0,
      ),
    ),
    trafficGap: gap.trafficGap,
    overlapVolume: ranking.reduce((carry, row) => carry + row.volume, 0),

    pageCount: draft.pages.length,
    contentDepth,
    authority,
    strongestPageIds: [...draft.pages]
      .sort((a, b) => b.threatScore - a.threatScore)
      .slice(0, 5)
      .map((page) => page.id),
    clusterIds,
    dominatedClusterIds: input.dominated,
    topIntents: [...intentTally.entries()]
      .sort(
        (a, b) =>
          b[1] - a[1] || INTENT_ORDER.indexOf(a[0]) - INTENT_ORDER.indexOf(b[0]),
      )
      .slice(0, 3)
      .map((entry) => entry[0]),
    weaknesses: weaknessesFor({
      draft,
      ourWins,
      shared: shared.length,
      contentDepth,
      footprint,
      authority,
    }),

    strength,
    threat,
    threatLevel: level,
    opportunity,
    momentum: { value: momentum },
    gaining: momentum > 2.5,

    headline: headlineFor({
      name: draft.name,
      level,
      theirWins,
      shared: shared.length,
      competitorOnly: draft.rows.filter((row) => row.overlap === "theirs-only")
        .length,
      dominated: input.dominated.length,
      trafficGap: gap.trafficGap,
    }),
    owner: "market-intelligence",
    seed: project.seed + hashOf(draft.domain),
  };
}

/** Where a rival is beatable, in the terms a strategist would use. */
function weaknessesFor(input: {
  readonly draft: Draft;
  readonly ourWins: number;
  readonly shared: number;
  readonly contentDepth: number;
  readonly footprint: RankingFootprint;
  readonly authority: number;
}): readonly string[] {
  const notes: string[] = [];
  const { footprint } = input;
  const total =
    footprint.topThree + footprint.topTen + footprint.topTwenty + footprint.beyond;

  if (footprint.topThree === 0) {
    notes.push("Holds no top-three position anywhere in this keyword set.");
  }

  if (total > 0 && footprint.beyond / total >= 0.45) {
    notes.push(
      `${footprint.beyond} of their ${total} rankings sit beyond position 20 — most of their footprint is weakly held.`,
    );
  }

  if (input.contentDepth < 55 && input.draft.pages.length > 0) {
    notes.push(
      `Their pages model at ${input.contentDepth}% depth for these topics — there is room to out-write them.`,
    );
  }

  if (input.shared > 0 && input.ourWins / input.shared >= 0.5) {
    notes.push(
      `We already out-rank them on ${input.ourWins} of ${input.shared} contested terms.`,
    );
  }

  if (input.authority < 45) {
    notes.push(
      "Modelled domain authority is below the set's midpoint, so rankings here are earned page by page.",
    );
  }

  const thinClusters = input.draft.presence.filter(
    (entry) => entry.strength < 30,
  );
  if (thinClusters.length >= 2) {
    notes.push(
      `Thin across ${thinClusters.length} of the ${input.draft.presence.length} topics they appear in.`,
    );
  }

  if (notes.length === 0) {
    notes.push(
      "No obvious weakness in this set — expect to earn every place against them.",
    );
  }

  return notes;
}

function headlineFor(input: {
  readonly name: string;
  readonly level: string;
  readonly theirWins: number;
  readonly shared: number;
  readonly competitorOnly: number;
  readonly dominated: number;
  readonly trafficGap: number;
}): string {
  if (input.dominated > 0) {
    return `${input.name} leads ${input.dominated} topic${input.dominated === 1 ? "" : "s"} outright and is ahead on ${input.theirWins} of ${input.shared} contested terms.`;
  }
  if (input.theirWins > input.shared / 2 && input.shared > 0) {
    return `${input.name} is ahead on ${input.theirWins} of ${input.shared} contested terms, worth about ${Math.round(input.trafficGap).toLocaleString("en-US")} sessions a month.`;
  }
  if (input.competitorOnly > 0) {
    return `${input.name} ranks for ${input.competitorOnly} terms we do not appear for at all.`;
  }
  return `${input.name} overlaps with this project without holding much of it.`;
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** Every competitor across the roster, strongest threat first within a project. */
export function getCompetitorRecords(): readonly CompetitorRecord[] {
  return built().records;
}

/** One competitor by id. */
export function getCompetitorRecord(id: string): CompetitorRecord | undefined {
  return getCompetitorRecords().find((record) => record.id === id);
}

/** Every competitor id, for prerendering the detail routes. */
export function getCompetitorIds(): readonly string[] {
  return getCompetitorRecords().map((record) => record.id);
}

/** Competitors tracked against one project, strongest threat first. */
export function competitorsForProject(
  projectId: string,
): readonly CompetitorRecord[] {
  return getCompetitorRecords().filter(
    (record) => record.projectId === projectId,
  );
}

/** Every keyword-and-competitor pairing. */
export function getOverlapRows(): readonly OverlapRow[] {
  return built().overlap;
}

/** The overlap rows for one competitor. */
export function overlapForCompetitor(
  competitorId: string,
): readonly OverlapRow[] {
  return getOverlapRows().filter((row) => row.competitorId === competitorId);
}

/** Every rival ranking against one keyword, best position first. */
export function overlapForKeyword(keywordId: string): readonly OverlapRow[] {
  return getOverlapRows()
    .filter((row) => row.keywordId === keywordId && row.theirPosition !== null)
    .sort(
      (a, b) => (a.theirPosition as number) - (b.theirPosition as number),
    );
}

/** Every modelled competitor page, biggest threat first. */
export function getCompetitorPages(): readonly CompetitorPage[] {
  return built().pages;
}

/** One competitor page by id. */
export function getCompetitorPage(id: string): CompetitorPage | undefined {
  return getCompetitorPages().find((page) => page.id === id);
}

/** The modelled pages for one competitor. */
export function pagesForCompetitor(
  competitorId: string,
): readonly CompetitorPage[] {
  return getCompetitorPages().filter(
    (page) => page.competitorId === competitorId,
  );
}

/** Every competitor's footing in every cluster. */
export function getClusterPresence(): readonly ClusterPresence[] {
  return built().presence;
}
