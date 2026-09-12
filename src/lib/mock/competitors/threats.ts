import { clamp } from "@/lib/mock/dashboard/core";
import { ctrAt, getKeywordRecords } from "@/lib/mock/keywords";
import { getContentRecords } from "@/lib/mock/content";
import {
  SEVERITY_ORDER,
  THREAT_KIND_ORDER,
} from "@/lib/mock/competitors/meta";
import {
  positionScore,
  severityFor,
  volumeScore,
} from "@/lib/mock/competitors/scoring";
import {
  getCompetitorPages,
  getOverlapRows,
} from "@/lib/mock/competitors/registry";
import { getClusterBattlegrounds } from "@/lib/mock/competitors/clusters";
import type { ContentRecord } from "@/types/content";
import type { KeywordRecord } from "@/types/keyword";
import type {
  AgentId,
  OverlapRow,
  SerpThreat,
  ThreatKind,
} from "@/types/competitor";

/**
 * What a rival is doing that needs answering.
 *
 * A gap is a place we have not built something. A threat is a movement: a
 * position lost this window, a valuable term taken, a topic being consolidated
 * while ours sits half-finished. The two views deliberately read the same data
 * and ask different questions of it, because "what is missing" and "what is
 * happening" are different meetings.
 *
 * Every threat carries the evidence that produced it in its own sentence, so
 * the severity can be checked rather than believed. A keyword raises at most
 * one threat per rival — the most serious kind that applies — so the list
 * stays a set of decisions rather than a log.
 */

/** How serious a kind is before the keyword's own value is applied. */
const KIND_WEIGHT: Record<ThreatKind, number> = {
  "new-outrank": 88,
  "high-value-held": 84,
  "decaying-page": 80,
  "multi-keyword-page": 72,
  "weak-cluster": 68,
  "cannibalised-pair": 66,
  "unmapped-keyword": 60,
  "answer-engine": 56,
};

const KIND_OWNER: Record<ThreatKind, AgentId> = {
  "new-outrank": "on-page-seo",
  "high-value-held": "content-strategist",
  "decaying-page": "writer",
  "multi-keyword-page": "content-strategist",
  "weak-cluster": "content-strategist",
  "cannibalised-pair": "on-page-seo",
  "unmapped-keyword": "keyword-intent",
  "answer-engine": "ai-visibility",
};

/** A high-value term: real volume behind it and real commercial intent. */
const HIGH_VALUE_VOLUME = 1_800;
const HIGH_VALUE_COMMERCIAL = 55;

function trafficAt(volume: number, position: number | null): number {
  return (volume * ctrAt(position)) / 100;
}

function theyLead(row: OverlapRow): boolean {
  if (row.theirPosition === null) return false;
  return row.ourPosition === null || row.theirPosition < row.ourPosition;
}

/**
 * The most serious thing this rival is doing on this keyword, or null.
 *
 * Tested in `THREAT_KIND_ORDER`, so a term that is both newly lost and highly
 * valuable is reported as the loss — the more urgent reading — rather than
 * twice.
 */
function kindFor(
  row: OverlapRow,
  keyword: KeywordRecord | undefined,
  content: ContentRecord | null,
): ThreatKind | null {
  if (keyword === undefined || row.theirPosition === null) return null;
  if (!theyLead(row)) return null;

  if (keyword.change <= -3 && row.ourPosition !== null) return "new-outrank";

  if (
    row.theirPosition <= 3 &&
    keyword.volume >= HIGH_VALUE_VOLUME &&
    keyword.commercialValue >= HIGH_VALUE_COMMERCIAL &&
    (row.ourPosition === null || row.ourPosition > 10)
  ) {
    return "high-value-held";
  }

  if (content !== null && content.health === "decaying") return "decaying-page";
  if (content !== null && content.cannibalised) return "cannibalised-pair";
  if (row.ourUrl === null) return "unmapped-keyword";

  if (
    keyword.ai.answerProjected &&
    keyword.ai.coverage !== "likely-source" &&
    row.theirPosition <= 10
  ) {
    return "answer-engine";
  }

  return null;
}

function scoreFor(input: {
  readonly kind: ThreatKind;
  readonly opportunity: number;
  readonly volume: number;
  readonly theirPosition: number;
}): number {
  return Math.round(
    clamp(
      KIND_WEIGHT[input.kind] * 0.36 +
        input.opportunity * 0.22 +
        volumeScore(input.volume) * 0.2 +
        positionScore(input.theirPosition) * 0.22,
      0,
      100,
    ),
  );
}

function rationaleFor(
  kind: ThreatKind,
  row: OverlapRow,
  keyword: KeywordRecord,
  content: ContentRecord | null,
): string {
  const ours =
    row.ourPosition === null ? "we do not rank" : `we sit at ${row.ourPosition}`;

  switch (kind) {
    case "new-outrank":
      return `We have lost ${Math.abs(keyword.change)} places on this term over the window and ${row.competitorName} now holds ${row.theirPosition} while ${ours}.`;
    case "high-value-held":
      return `${keyword.volume.toLocaleString("en-US")} searches a month at a commercial value of ${keyword.commercialValue}/100, held at ${row.theirPosition} by ${row.competitorName} while ${ours}.`;
    case "decaying-page":
      return `Our page on this term is losing ground and scores ${content?.score.score ?? 0}/100, while ${row.competitorName} holds ${row.theirPosition}.`;
    case "cannibalised-pair":
      return `Two pages of ours target this term and neither wins it; ${row.competitorName} targets it once and holds ${row.theirPosition}.`;
    case "unmapped-keyword":
      return `No live page of ours is built for this term. ${row.competitorName} ranks ${row.theirPosition} against ${keyword.volume.toLocaleString("en-US")} searches a month.`;
    case "answer-engine":
      return `An answer is projected on this query and nothing of ours is positioned for it. ${row.competitorName} is placed for it at position ${row.theirPosition}; ${ours}.`;
    case "multi-keyword-page":
      return `A single page of ${row.competitorName}'s is out-ranking us across several of this cluster's terms.`;
    case "weak-cluster":
      return `${row.competitorName} is consolidating this topic while our coverage is incomplete.`;
  }
}

function responseFor(kind: ThreatKind, keyword: string | null): string {
  switch (kind) {
    case "new-outrank":
      return "Audit what changed on their page and ours, then refresh ours before the gap sets.";
    case "high-value-held":
      return "Treat this as a campaign, not an edit: the page, the internal links, and the authority behind it.";
    case "decaying-page":
      return "Refresh the page now — a decaying page loses the term whether or not they push.";
    case "cannibalised-pair":
      return "Consolidate onto one page and re-point the internal links before optimising anything.";
    case "unmapped-keyword":
      return `Map “${keyword}” to a page that exists, or brief one for it.`;
    case "answer-engine":
      return "Add a self-contained answer under a matching heading, with a sourced figure in it.";
    case "multi-keyword-page":
      return "Match their scope on one page or split ours so each term is properly targeted.";
    case "weak-cluster":
      return "Finish the cluster: pillar first, then the supporting pages that are missing.";
  }
}

let cache: readonly SerpThreat[] | null = null;

/** Every competitive threat, most serious first. */
export function getSerpThreats(): readonly SerpThreat[] {
  cache ??= build();
  return cache;
}

function build(): readonly SerpThreat[] {
  const rows = getOverlapRows();
  const pages = getCompetitorPages();
  const battlegrounds = getClusterBattlegrounds();

  const keywordById = new Map(
    getKeywordRecords().map((record) => [record.id, record]),
  );
  const contentById = new Map(
    getContentRecords().map((record) => [record.id, record]),
  );

  const threats: SerpThreat[] = [];

  // --- Keyword-level ----------------------------------------------------

  for (const row of rows) {
    const keyword = keywordById.get(row.keywordId);
    const content =
      row.ourContentId === null
        ? null
        : (contentById.get(row.ourContentId) ?? null);

    const kind = kindFor(row, keyword, content);
    if (kind === null || keyword === undefined || row.theirPosition === null) {
      continue;
    }

    const score = scoreFor({
      kind,
      opportunity: row.opportunity,
      volume: row.volume,
      theirPosition: row.theirPosition,
    });

    threats.push({
      id: `${row.competitorId}--threat-${kind}-${row.keywordId}`,
      kind,
      severity: severityFor(score),
      score,

      competitorId: row.competitorId,
      competitorName: row.competitorName,
      competitorDomain: row.competitorDomain,
      projectId: row.projectId,
      projectName: row.projectName,

      keywordId: row.keywordId,
      keyword: row.keyword,
      clusterId: row.clusterId,
      clusterName: row.clusterName,
      theirPageId: row.theirPageId,
      theirUrl: row.theirUrl,
      ourContentId: row.ourContentId,
      ourUrl: row.ourUrl,

      volume: row.volume,
      valueAtRisk: Math.round(trafficAt(row.volume, row.theirPosition)),

      headline: `${row.competitorName} holds position ${row.theirPosition} on “${row.keyword}”`,
      rationale: rationaleFor(kind, row, keyword, content),
      response: responseFor(kind, row.keyword),
      owner: KIND_OWNER[kind],
    });
  }

  // --- One page taking several terms ------------------------------------

  for (const page of pages) {
    const beating = page.topKeywords.filter(
      (entry) => entry.ourPosition === null || entry.position < entry.ourPosition,
    );
    if (page.keywordCount < 4 || beating.length < 3) continue;

    const score = Math.round(
      clamp(
        KIND_WEIGHT["multi-keyword-page"] * 0.34 +
          page.threatScore * 0.34 +
          volumeScore(page.totalVolume) * 0.32,
        0,
        100,
      ),
    );

    threats.push({
      id: `${page.id}--threat-multi-keyword`,
      kind: "multi-keyword-page",
      severity: severityFor(score),
      score,

      competitorId: page.competitorId,
      competitorName: page.competitorName,
      competitorDomain: page.domain,
      projectId: page.projectId,
      projectName: page.projectName,

      keywordId: null,
      keyword: null,
      clusterId: page.clusterId,
      clusterName: page.clusterName,
      theirPageId: page.id,
      theirUrl: page.url,
      ourContentId: page.ourContentId,
      ourUrl: page.ourUrl,

      volume: page.totalVolume,
      valueAtRisk: page.estimatedTraffic,

      headline: `One page of ${page.competitorName}'s takes ${beating.length} of our ${page.clusterName} terms`,
      rationale: `${page.url} ranks for ${page.keywordCount} terms in this cluster, ${beating.length} of them ahead of us, from position ${page.bestPosition} at best.`,
      response:
        page.ourContentId === null
          ? "Nothing of ours covers this scope. Brief a page that does before chasing the individual terms."
          : "Match their scope on our page, or split ours so each term has a page that targets it properly.",
      owner: KIND_OWNER["multi-keyword-page"],
    });
  }

  // --- Topics being taken while ours is unfinished ----------------------

  for (const cluster of battlegrounds) {
    const dominant = cluster.dominant;
    if (dominant === null) continue;
    if (cluster.state !== "they-lead") continue;
    if (cluster.coverage >= 90 && cluster.hasPillar) continue;

    const score = Math.round(
      clamp(
        KIND_WEIGHT["weak-cluster"] * 0.34 +
          dominant.strength * 0.24 +
          (100 - cluster.coverage) * 0.2 +
          volumeScore(cluster.totalVolume) * 0.22,
        0,
        100,
      ),
    );

    threats.push({
      id: `${dominant.competitorId}--threat-weak-cluster-${cluster.clusterId}`,
      kind: "weak-cluster",
      severity: severityFor(score),
      score,

      competitorId: dominant.competitorId,
      competitorName: dominant.name,
      competitorDomain: dominant.domain,
      projectId: cluster.projectId,
      projectName: cluster.projectName,

      keywordId: null,
      keyword: null,
      clusterId: cluster.clusterId,
      clusterName: cluster.clusterName,
      theirPageId: null,
      theirUrl: null,
      ourContentId: null,
      ourUrl: null,

      volume: cluster.totalVolume,
      valueAtRisk: 0,

      headline: `${dominant.name} is taking ${cluster.clusterName}`,
      rationale: `They rank for ${dominant.keywords} of this cluster's ${cluster.keywordCount} terms across ${dominant.pages} pages${cluster.hasPillar ? "" : ", and we have not published its pillar"}. Our coverage is ${cluster.coverage}%.`,
      response: responseFor("weak-cluster", null),
      owner: KIND_OWNER["weak-cluster"],
    });
  }

  return threats.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      b.score - a.score ||
      THREAT_KIND_ORDER.indexOf(a.kind) - THREAT_KIND_ORDER.indexOf(b.kind) ||
      a.competitorName.localeCompare(b.competitorName),
  );
}

/** The threats one competitor is causing. */
export function threatsForCompetitor(
  competitorId: string,
): readonly SerpThreat[] {
  return getSerpThreats().filter(
    (threat) => threat.competitorId === competitorId,
  );
}
