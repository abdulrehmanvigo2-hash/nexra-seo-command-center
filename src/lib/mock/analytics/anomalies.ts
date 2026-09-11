import { getKeywordClusters, getKeywordList } from "@/lib/mock/keywords";
import { technicalPageForContent } from "@/lib/mock/technical";
import { aiPageForContent } from "@/lib/mock/ai-visibility";
import { getPagePerformance } from "@/lib/mock/analytics/pages";
import {
  ANOMALY_FLOOR,
  anomalyConfidence,
  changeBetween,
  directionFor,
  headroomFor,
  significanceFor,
} from "@/lib/mock/analytics/scoring";
import type { Anomaly, AnalyticsSeries } from "@/types/analytics";
import type { KeywordRecord } from "@/types/keyword";

/**
 * Movements worth explaining.
 *
 * Two rules govern this layer, and both exist to stop it manufacturing drama.
 *
 * First, nothing below the notable band is raised at all. Most week-to-week
 * movement in a dataset this size is indistinguishable from sampling, and an
 * anomaly list that included it would send agents chasing noise.
 *
 * Second, an explanation is only attached where a canonical finding from
 * another module actually accounts for it — a URL that stopped serving, a page
 * dropped from the index, an answer-engine blocker. Where nothing explains the
 * movement, the record says so and carries no confidence. Reaching for a
 * plausible story would be the single most damaging thing this module could do.
 */

/** A page-level anomaly, with the canonical finding behind it where one exists. */
function explainPage(contentId: string): {
  explanation: string | null;
  href: string | null;
} {
  const technical = technicalPageForContent(contentId);

  if (technical) {
    if (
      technical.crawlState === "broken" ||
      technical.crawlState === "server-error"
    ) {
      return {
        explanation: `Technical SEO reports this URL answering ${technical.httpStatus}. Nothing is being served.`,
        href: `/technical/pages/${technical.id}`,
      };
    }
    if (technical.indexStatus === "not-indexed") {
      return {
        explanation:
          "Technical SEO reports this URL as eligible for the index and not in it.",
        href: `/technical/pages/${technical.id}`,
      };
    }
    if (technical.indexability === "noindex") {
      return {
        explanation:
          "Technical SEO reports a noindex directive on this URL, so it is excluded by its own instruction.",
        href: `/technical/pages/${technical.id}`,
      };
    }
    if (technical.canonicalState === "conflict") {
      return {
        explanation:
          "Technical SEO reports a canonical conflict on this URL, so which version ranks is not ours to decide.",
        href: `/technical/pages/${technical.id}`,
      };
    }
  }

  const ai = aiPageForContent(contentId);
  if (ai && ai.citation.blocked) {
    return {
      explanation:
        "AI Visibility reports this URL as unreachable for answer engines.",
      href: `/content/${contentId}?tab=ai`,
    };
  }

  return { explanation: null, href: null };
}

/**
 * Anomalies across a selection.
 *
 * Takes the series and the pages rather than reaching for the registry, so
 * narrowing to one project narrows the anomalies with it.
 */
export function getAnomalies(
  series: AnalyticsSeries,
  projectIds: readonly string[],
): readonly Anomaly[] {
  const out: Anomaly[] = [];
  const scoped = new Set(projectIds);

  const projectLabel =
    projectIds.length === 1
      ? (getPagePerformance().find((page) => page.projectId === projectIds[0])
          ?.projectName ?? "the portfolio")
      : "the portfolio";
  const projectId = projectIds.length === 1 ? projectIds[0] : "portfolio";

  // -- series-level movement ---------------------------------------------
  // Only a rise is checked here, and that is a property of the data rather
  // than a choice: the canonical trend series compounds upward by
  // construction, so a falling total is not something it can produce. Real
  // declines in this product live in the keyword and page records, and they
  // are picked up below rather than invented here.
  const trafficChange = series.deltas.organicTraffic;
  if (trafficChange >= ANOMALY_FLOOR) {
    const significance = significanceFor(trafficChange);
    out.push({
      id: `anomaly-${projectId}-traffic-rise`,
      kind: "traffic-spike",
      projectId,
      projectName: projectLabel,
      label: "Organic sessions",
      finding: `Organic sessions rose ${trafficChange}% against the previous ${series.range.caption.toLowerCase()}.`,
      direction: directionFor(trafficChange),
      significance,
      change: trafficChange,
      // A series-level movement is the sum of everything, so no single
      // canonical finding accounts for it. Saying so beats guessing.
      explanation: null,
      explanationHref: null,
      confidence: anomalyConfidence(false, significance),
      owner: "analytics-learning",
      provenance: "series",
    });
  }

  // -- page decay ---------------------------------------------------------
  const pages = getPagePerformance().filter((page) =>
    scoped.has(page.projectId),
  );

  for (const page of pages) {
    if (page.state !== "decaying") continue;
    if (page.traffic < 40) continue;

    const change = changeBetween(
      page.traffic,
      Math.max(page.traffic + Math.abs(page.positionChange) * 12, 1),
    );
    const significance = significanceFor(change);
    if (significance === "noise" || significance === "slight") continue;

    const { explanation, href } = explainPage(page.contentId);

    out.push({
      id: `anomaly-decay-${page.contentId}`,
      kind: "page-decay",
      projectId: page.projectId,
      projectName: page.projectName,
      label: page.title,
      finding: `Down ${Math.abs(page.positionChange)} places on average across its keywords, carrying ${page.traffic} sessions a month.`,
      direction: "down",
      significance,
      change,
      explanation,
      explanationHref: href,
      confidence: anomalyConfidence(explanation !== null, significance),
      owner: explanation === null ? "analytics-learning" : "technical-seo",
      provenance: "derived",
    });
  }

  // -- ranking collapse ---------------------------------------------------
  // Keyword position change is one of the few readings in this product that
  // genuinely moves both ways, so a cluster losing ground across several of
  // its terms at once is a decline the data can actually support.
  const keywordsByCluster = new Map<string, KeywordRecord[]>();
  for (const record of getKeywordList()) {
    if (!scoped.has(record.projectId)) continue;
    const bucket = keywordsByCluster.get(record.clusterId);
    if (bucket) bucket.push(record);
    else keywordsByCluster.set(record.clusterId, [record]);
  }

  for (const [clusterId, records] of keywordsByCluster) {
    const fell = records.filter((record) => record.change <= -3);
    if (fell.length < 3) continue;

    const meanDrop = Math.round(
      fell.reduce((carry, record) => carry + record.change, 0) / fell.length,
    );
    const first = records[0];
    const significance = fell.length >= 6 ? "material" : "notable";

    out.push({
      id: `anomaly-collapse-${clusterId}`,
      kind: "ranking-collapse",
      projectId: first.projectId,
      projectName: first.projectName,
      label: first.clusterName,
      finding: `${fell.length} keywords in this cluster lost ground, averaging ${meanDrop} places.`,
      direction: "down",
      significance,
      change: meanDrop,
      explanation: null,
      explanationHref: `/keywords/clusters/${clusterId}`,
      // A cluster losing position has no single canonical cause in this
      // product, so the record points at the cluster rather than claiming one.
      confidence: "none",
      owner: "keyword-intent",
      provenance: "derived",
    });
  }

  // -- concentration risk -------------------------------------------------
  // Not a movement at all, but the thing a performance review most often
  // misses: a project can look healthy while almost all of it rests on two
  // pages, and losing either would take the quarter with it.
  for (const project of scoped) {
    const projectPages = pages.filter((page) => page.projectId === project);
    if (projectPages.length < 8) continue;

    const total = projectPages.reduce((carry, page) => carry + page.traffic, 0);
    if (total < 200) continue;

    const ranked = [...projectPages].sort((a, b) => b.traffic - a.traffic);
    const topThree = ranked
      .slice(0, 3)
      .reduce((carry, page) => carry + page.traffic, 0);
    const share = Math.round((topThree / total) * 100);
    if (share < 60) continue;

    out.push({
      id: `anomaly-concentration-${project}`,
      kind: "traffic-concentration",
      projectId: project,
      projectName: ranked[0].projectName,
      label: `${ranked[0].projectName} traffic concentration`,
      finding: `${share}% of this project's organic sessions come from ${ranked.length >= 3 ? "three" : String(ranked.length)} pages.`,
      direction: "flat",
      significance: share >= 75 ? "material" : "notable",
      change: share,
      explanation: `${ranked[0].title} alone carries ${Math.round((ranked[0].traffic / total) * 100)}% of it.`,
      explanationHref: `/content/${ranked[0].contentId}`,
      confidence: "high",
      owner: "seo-director",
      provenance: "derived",
    });
  }

  // -- cluster stall ------------------------------------------------------
  // A cluster with real potential converting almost none of it is a different
  // problem from a cluster that is simply small, so the check is on headroom
  // rather than on traffic.
  for (const cluster of getKeywordClusters()) {
    if (!scoped.has(cluster.projectId)) continue;
    if (cluster.trafficPotential < 500) continue;

    const clusterPages = pages.filter(
      (page) => page.clusterId === cluster.id,
    );
    const traffic = clusterPages.reduce(
      (carry, page) => carry + page.traffic,
      0,
    );
    const headroom = headroomFor(traffic, cluster.trafficPotential);
    if (headroom < 85) continue;

    out.push({
      id: `anomaly-stall-${cluster.id}`,
      kind: "cluster-stall",
      projectId: cluster.projectId,
      projectName: cluster.projectName,
      label: cluster.name,
      finding: `${headroom}% of this cluster's potential is unclaimed — ${traffic} sessions against a possible ${cluster.trafficPotential}.`,
      direction: "flat",
      significance: headroom >= 95 ? "material" : "notable",
      change: -headroom,
      explanation:
        cluster.contentGaps > 0
          ? `${cluster.contentGaps} keywords in this cluster have no page behind them.`
          : null,
      explanationHref:
        cluster.contentGaps > 0
          ? `/keywords/clusters/${cluster.id}`
          : null,
      confidence: anomalyConfidence(
        cluster.contentGaps > 0,
        headroom >= 95 ? "material" : "notable",
      ),
      owner: cluster.owner,
      provenance: "derived",
    });
  }

  return out.sort(
    (a, b) =>
      Math.abs(b.change) - Math.abs(a.change) || a.id.localeCompare(b.id),
  );
}
