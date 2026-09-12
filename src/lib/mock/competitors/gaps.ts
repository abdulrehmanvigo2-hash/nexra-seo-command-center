import { clamp } from "@/lib/mock/dashboard/core";
import { getKeywordRecords } from "@/lib/mock/keywords";
import { getContentRecords } from "@/lib/mock/content";
import {
  GAP_KIND_ORDER,
  SEVERITY_ORDER,
} from "@/lib/mock/competitors/meta";
import { severityFor, volumeScore } from "@/lib/mock/competitors/scoring";
import {
  getClusterPresence,
  getCompetitorPages,
  getOverlapRows,
} from "@/lib/mock/competitors/registry";
import { getClusterBattlegrounds } from "@/lib/mock/competitors/clusters";
import type { ContentRecord } from "@/types/content";
import type { KeywordRecord } from "@/types/keyword";
import type {
  AgentId,
  CompetitorGap,
  CompetitorGapKind,
  OverlapRow,
} from "@/types/competitor";

/**
 * Where a rival covers something we do not.
 *
 * Every finding is anchored to evidence that already exists: a keyword we do
 * not rank for, a page of ours the content module scores badly, a cluster with
 * fewer pages than theirs, an alignment the content module already flagged.
 * Nothing here re-judges a page — it reads the judgement the Content Studio
 * has already made and states what a competitor is doing about it.
 *
 * A keyword produces at most one gap per competitor. The kinds are ordered by
 * what a strategist fixes first, and the first that applies wins, so the counts
 * across the eight kinds add up to the number of gaps rather than double-
 * counting a page that is both thin and stale.
 */

/** How urgent a kind is on its own, before the keyword's own value. */
const KIND_WEIGHT: Record<CompetitorGapKind, number> = {
  "no-page": 92,
  "weak-page": 74,
  cannibalised: 86,
  "cluster-depth": 66,
  "intent-miss": 62,
  "multi-term-page": 70,
  "refresh-needed": 58,
  "serp-feature": 54,
};

const KIND_OWNER: Record<CompetitorGapKind, AgentId> = {
  "no-page": "content-strategist",
  "weak-page": "writer",
  cannibalised: "on-page-seo",
  "cluster-depth": "content-strategist",
  "intent-miss": "content-strategist",
  "multi-term-page": "on-page-seo",
  "refresh-needed": "writer",
  "serp-feature": "ai-visibility",
};

/**
 * How big a gap is.
 *
 * Weighted towards what the term is worth rather than what kind of gap it is.
 * A heavy kind weight would put a floor under every finding and flatten the
 * severity column — a missing page on a term nobody searches for is not a
 * critical finding, and the score has to be able to say so.
 */
function scoreFor(kind: CompetitorGapKind, row: OverlapRow): number {
  return Math.round(
    clamp(
      row.opportunity * 0.46 +
        KIND_WEIGHT[kind] * 0.26 +
        volumeScore(row.volume) * 0.28,
      0,
      100,
    ),
  );
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

/** True where the rival is ahead of us on this term, or we are absent. */
function theyLead(row: OverlapRow): boolean {
  if (row.theirPosition === null) return false;
  return row.ourPosition === null || row.theirPosition < row.ourPosition;
}

/**
 * Why this keyword is a gap against this rival, or null where it is not.
 *
 * Read in severity order. A term nothing of ours targets is the first problem;
 * a page splitting against itself is the next, because the fix changes which
 * page ranks at all; then quality, then format, then the result page itself.
 */
function kindFor(
  row: OverlapRow,
  keyword: KeywordRecord | undefined,
  content: ContentRecord | null,
): CompetitorGapKind | null {
  if (row.theirPosition === null) return null;

  // Nothing of ours is live on this term.
  if (row.ourUrl === null) return "no-page";
  if (!theyLead(row)) return null;

  if (content !== null && content.cannibalised) return "cannibalised";
  if (
    content !== null &&
    (content.health === "decaying" || content.health === "needs-refresh")
  ) {
    return "refresh-needed";
  }
  if (content !== null && content.score.score < 60) return "weak-page";
  if (content !== null && content.intentAlignment !== "aligned") {
    return "intent-miss";
  }

  if (keyword !== undefined) {
    const heldFeature = keyword.serpFeatures.some(
      (feature) => feature.ownership === "competitor",
    );
    const aiGap = keyword.ai.answerProjected && keyword.ai.coverage !== "likely-source";
    if (heldFeature || aiGap) return "serp-feature";
  }

  return null;
}

function findingFor(
  kind: CompetitorGapKind,
  row: OverlapRow,
  content: ContentRecord | null,
): string {
  const them = `${row.competitorName} ranks ${row.theirPosition}`;

  switch (kind) {
    case "no-page":
      return `${them} for “${row.keyword}” and no live page of ours targets it.`;
    case "weak-page":
      return `${them} against our page scoring ${content?.score.score ?? 0}/100 at position ${row.ourPosition ?? "—"}.`;
    case "cannibalised":
      return `${them} with one page while two of ours compete for “${row.keyword}”.`;
    case "cluster-depth":
      return `${row.competitorName} covers this topic across more pages than we have written for it.`;
    case "intent-miss":
      return `${them}. Our page is a ${content?.format ?? "page"} where the query asks for something else.`;
    case "multi-term-page":
      return `One page of ${row.competitorName}'s is taking several of this cluster's terms at once.`;
    case "refresh-needed":
      return `${them} while our page has been ${content?.health === "decaying" ? "losing places" : "flagged for refresh"} since it was last touched.`;
    case "serp-feature":
      return `${them}, and the result page carries a feature or generated answer we are not in.`;
  }
}

function actionFor(
  kind: CompetitorGapKind,
  keyword: string | null,
  clusterName: string,
): string {
  switch (kind) {
    case "no-page":
      return `Brief a page for “${keyword}” against the ${clusterName} cluster, then map the term to it.`;
    case "weak-page":
      return "Rebuild the page to cover what theirs answers and ours does not, then re-check the score.";
    case "cannibalised":
      return "Decide which page owns the term, consolidate the other, and re-point the internal links.";
    case "cluster-depth":
      return "Add the supporting pages the topic is missing before optimising the ones that exist.";
    case "intent-miss":
      return "Re-cut the page into the format the query asks for, or move the term to a page that already is one.";
    case "multi-term-page":
      return "Either match their scope on one page, or split ours so each term has a page that targets it properly.";
    case "refresh-needed":
      return "Refresh the page: re-check the figures, replace the examples, and re-date it once it is genuinely revised.";
    case "serp-feature":
      return "Add a short, self-contained answer under a matching heading so the page is quotable.";
  }
}

let cache: readonly CompetitorGap[] | null = null;

/** Every competitive content gap, biggest first. */
export function getCompetitorGapFindings(): readonly CompetitorGap[] {
  cache ??= build();
  return cache;
}

function build(): readonly CompetitorGap[] {
  const rows = getOverlapRows();
  const pages = getCompetitorPages();
  const battlegrounds = getClusterBattlegrounds();
  const presence = getClusterPresence();

  const keywordById = new Map(
    getKeywordRecords().map((record) => [record.id, record]),
  );
  const contentById = new Map(
    getContentRecords().map((record) => [record.id, record]),
  );
  const clusterById = new Map(
    battlegrounds.map((entry) => [entry.clusterId, entry]),
  );

  /**
   * What a rival's hold on a cluster is worth, and how hard it is.
   *
   * A cluster-level finding has no keyword of its own, and reporting it with a
   * value of zero would sort it below every keyword gap in a list ordered by
   * value. Both figures are read from the cluster's own contested rows.
   */
  const clusterStakes = new Map<
    string,
    { value: number; difficulty: number[] }
  >();
  for (const row of rows) {
    if (row.theirPosition === null) continue;
    if (row.ourPosition !== null && row.theirPosition >= row.ourPosition) continue;
    const key = `${row.competitorId}::${row.clusterId}`;
    const bucket = clusterStakes.get(key);
    if (bucket) {
      bucket.value += row.trafficAtStake;
      bucket.difficulty.push(row.difficulty);
    } else {
      clusterStakes.set(key, {
        value: row.trafficAtStake,
        difficulty: [row.difficulty],
      });
    }
  }

  const results: CompetitorGap[] = [];

  // --- Keyword-level findings -------------------------------------------

  for (const row of rows) {
    const content =
      row.ourContentId === null
        ? null
        : (contentById.get(row.ourContentId) ?? null);
    const kind = kindFor(row, keywordById.get(row.keywordId), content);
    if (kind === null) continue;

    const score = scoreFor(kind, row);

    results.push({
      id: `${row.competitorId}--gap-${kind}-${row.keywordId}`,
      kind,
      severity: severityFor(score),

      competitorId: row.competitorId,
      competitorName: row.competitorName,
      competitorDomain: row.competitorDomain,
      projectId: row.projectId,
      projectName: row.projectName,

      keywordId: row.keywordId,
      keyword: row.keyword,
      clusterId: row.clusterId,
      clusterName: row.clusterName,
      intent: row.intent,

      volume: row.volume,
      difficulty: row.difficulty,
      value: row.trafficAtStake,

      theirPageId: row.theirPageId,
      theirUrl: row.theirUrl,
      theirPosition: row.theirPosition,
      ourContentId: row.ourContentId,
      ourUrl: row.ourUrl,
      ourPosition: row.ourPosition,

      finding: findingFor(kind, row, content),
      action: actionFor(kind, row.keyword, row.clusterName),
      owner: KIND_OWNER[kind],
      score,
    });
  }

  // --- One page of theirs taking several terms --------------------------

  for (const page of pages) {
    const contested = page.topKeywords.filter(
      (entry) => entry.ourPosition === null || entry.position < entry.ourPosition,
    );
    if (page.keywordCount < 4 || contested.length < 2) continue;

    const lead = rows.find(
      (row) =>
        row.competitorId === page.competitorId &&
        row.keywordId === page.topKeywords[0]?.id,
    );
    if (!lead) continue;

    const score = Math.round(
      clamp(
        page.threatScore * 0.42 +
          KIND_WEIGHT["multi-term-page"] * 0.24 +
          volumeScore(page.totalVolume) * 0.34,
        0,
        100,
      ),
    );

    results.push({
      id: `${page.id}--gap-multi-term`,
      kind: "multi-term-page",
      severity: severityFor(score),

      competitorId: page.competitorId,
      competitorName: page.competitorName,
      competitorDomain: page.domain,
      projectId: page.projectId,
      projectName: page.projectName,

      keywordId: null,
      keyword: null,
      clusterId: page.clusterId,
      clusterName: page.clusterName,
      intent: page.intent,

      volume: page.totalVolume,
      difficulty: lead.difficulty,
      value: Math.round(page.estimatedTraffic),

      theirPageId: page.id,
      theirUrl: page.url,
      theirPosition: page.bestPosition,
      ourContentId: page.ourContentId,
      ourUrl: page.ourUrl,
      ourPosition:
        page.topKeywords
          .map((entry) => entry.ourPosition)
          .filter((value): value is number => value !== null)
          .sort((a, b) => a - b)[0] ?? null,

      finding: `${page.competitorName} takes ${contested.length} of this page's ${page.keywordCount} terms ahead of us from a single URL.`,
      action: actionFor("multi-term-page", lead.keyword, page.clusterName),
      owner: KIND_OWNER["multi-term-page"],
      score,
    });
  }

  // --- Topics they cover more deeply than we do -------------------------

  for (const entry of presence) {
    const cluster = clusterById.get(entry.clusterId);
    if (!cluster) continue;
    // Depth is measured in terms ranked, not pages published. We routinely
    // have more pages in a cluster than a rival does and still rank for less
    // of it, and page count alone would report that as coverage we do not have.
    if (entry.keywords <= cluster.ourKeywords) continue;

    const score = Math.round(
      clamp(
        KIND_WEIGHT["cluster-depth"] * 0.4 +
          ((entry.keywords - cluster.ourKeywords) / Math.max(cluster.keywordCount, 1)) *
            100 *
            0.28 +
          volumeScore(cluster.totalVolume) * 0.32,
        0,
        100,
      ),
    );

    results.push({
      id: `${entry.competitorId}--gap-cluster-depth-${entry.clusterId}`,
      kind: "cluster-depth",
      severity: severityFor(score),

      competitorId: entry.competitorId,
      competitorName: entry.competitorName,
      competitorDomain: entry.competitorDomain,
      projectId: cluster.projectId,
      projectName: cluster.projectName,

      keywordId: null,
      keyword: null,
      clusterId: cluster.clusterId,
      clusterName: cluster.clusterName,
      intent: cluster.intent,

      volume: cluster.totalVolume,
      difficulty: Math.round(
        mean(
          clusterStakes.get(`${entry.competitorId}::${entry.clusterId}`)
            ?.difficulty ?? [],
        ) ?? 0,
      ),
      value: Math.round(
        clusterStakes.get(`${entry.competitorId}::${entry.clusterId}`)?.value ??
          0,
      ),

      theirPageId: null,
      theirUrl: null,
      theirPosition: entry.averagePosition,
      ourContentId: null,
      ourUrl: null,
      ourPosition: cluster.ourAveragePosition,

      finding: `${entry.competitorName} ranks for ${entry.keywords} of this cluster's ${cluster.keywordCount} terms against our ${cluster.ourKeywords}, across ${entry.pages} page${entry.pages === 1 ? "" : "s"} to our ${cluster.ourPages}.`,
      action: actionFor("cluster-depth", null, cluster.clusterName),
      owner: KIND_OWNER["cluster-depth"],
      score,
    });
  }

  return results.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      b.score - a.score ||
      GAP_KIND_ORDER.indexOf(a.kind) - GAP_KIND_ORDER.indexOf(b.kind) ||
      a.competitorName.localeCompare(b.competitorName),
  );
}

/** The gaps against one competitor. */
export function gapsForCompetitor(
  competitorId: string,
): readonly CompetitorGap[] {
  return getCompetitorGapFindings().filter(
    (gap) => gap.competitorId === competitorId,
  );
}
