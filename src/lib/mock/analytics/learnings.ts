import { mean } from "@/lib/mock/analytics/scoring";
import type {
  Anomaly,
  AttributionRecord,
  Learning,
  PagePerformance,
  SegmentRow,
} from "@/types/analytics";

/**
 * What the data suggests doing next, routed to the agent that would do it.
 *
 * This is the loop CLAUDE.md §13 describes closing: Analytics feeds the SEO
 * Director, which re-prioritises the next cycle. A learning is only worth
 * routing if somebody can act on it, so each one names its evidence, its
 * recommendation, and the agent it belongs to.
 *
 * Every learning is derived from records already on screen elsewhere in this
 * module — segments, pages, anomalies, attribution. None is invented, and
 * where the evidence only supports watching rather than acting, the verdict
 * says `watch` rather than manufacturing a recommendation.
 */

type Input = {
  readonly projectId: string;
  readonly projectName: string;
  readonly segments: readonly SegmentRow[];
  readonly pages: readonly PagePerformance[];
  readonly anomalies: readonly Anomaly[];
  readonly attribution: readonly AttributionRecord[];
};

export function getLearnings(input: Input): readonly Learning[] {
  const { projectId, projectName, segments, pages, anomalies, attribution } =
    input;
  const out: Learning[] = [];

  // -- what is working ----------------------------------------------------
  const compounding = pages.filter((page) => page.state === "compounding");
  if (compounding.length >= 3) {
    const formats = new Map<string, number>();
    for (const page of compounding) {
      formats.set(page.clusterName, (formats.get(page.clusterName) ?? 0) + 1);
    }
    const leader = [...formats.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];

    out.push({
      id: `learning-${projectId}-compounding`,
      projectId,
      projectName,
      verdict: "repeat",
      headline: `${compounding.length} pages are compounding`,
      observation: `${compounding.length} published pages are carrying most of their potential and still gaining position, concentrated in ${leader[0]}.`,
      evidence: compounding
        .slice(0, 4)
        .map((page) => `${page.title} — ${page.traffic} sessions, ${page.positionChange > 0 ? "+" : ""}${page.positionChange} places`),
      recommendation: `Brief more of what is working in ${leader[0]} before spreading effort into clusters with nothing behind them yet.`,
      owner: "seo-director",
      href: `/content?project=${projectId}`,
      confidence: "medium",
      provenance: "derived",
    });
  }

  // -- what is not --------------------------------------------------------
  const underperforming = pages.filter(
    (page) => page.state === "underperforming",
  );
  const wastedHeadroom = underperforming.reduce(
    (carry, page) => carry + page.headroom,
    0,
  );

  if (underperforming.length >= 4 && wastedHeadroom > 500) {
    out.push({
      id: `learning-${projectId}-underperforming`,
      projectId,
      projectName,
      verdict: "investigate",
      headline: `${Math.round(wastedHeadroom)} sessions a month sit unclaimed on existing pages`,
      observation: `${underperforming.length} published pages are well below what their own keywords could carry. The pages exist; the positions do not.`,
      evidence: [...underperforming]
        .sort((a, b) => b.headroom - a.headroom)
        .slice(0, 4)
        .map((page) => `${page.title} — ${page.traffic} of a possible ${page.potential}`),
      recommendation:
        "Improving pages that already rank is cheaper than publishing new ones. Take the largest gaps to On-Page SEO before commissioning anything new.",
      owner: "seo-director",
      href: `/content?project=${projectId}`,
      confidence: "medium",
      provenance: "derived",
    });
  }

  // -- decay worth catching ----------------------------------------------
  const decaying = pages.filter((page) => page.state === "decaying");
  if (decaying.length >= 2) {
    const explained = anomalies.filter(
      (anomaly) => anomaly.kind === "page-decay" && anomaly.explanation !== null,
    );

    out.push({
      id: `learning-${projectId}-decay`,
      projectId,
      projectName,
      verdict: decaying.length >= 5 ? "stop" : "investigate",
      headline: `${decaying.length} pages are losing ground`,
      observation:
        explained.length > 0
          ? `${decaying.length} pages are declining, and ${explained.length} of them have a technical finding that accounts for it.`
          : `${decaying.length} pages are declining, and nothing in the other modules explains why.`,
      evidence: decaying
        .slice(0, 4)
        .map((page) => `${page.title} — ${page.positionChange} places`),
      recommendation:
        explained.length > 0
          ? "Clear the technical findings behind the explained declines first; they are the cheapest recoveries available."
          : "Nothing here points at a cause. Compare these pages against what now outranks them before committing a refresh.",
      owner: explained.length > 0 ? "technical-seo" : "content-strategist",
      href: explained.length > 0 ? "/technical?tab=issues" : `/content?project=${projectId}`,
      confidence: explained.length > 0 ? "high" : "low",
      provenance: "derived",
    });
  }

  // -- where the headroom is ---------------------------------------------
  const stalled = segments
    .filter((row) => row.potential - row.traffic > 400 && row.headroom >= 70)
    .sort((a, b) => b.potential - b.traffic - (a.potential - a.traffic));

  if (stalled.length > 0) {
    const top = stalled[0];
    out.push({
      id: `learning-${projectId}-headroom`,
      projectId,
      projectName,
      verdict: "repeat",
      headline: `${top.label} holds the largest unclaimed opportunity`,
      observation: `${top.label} is carrying ${top.traffic} sessions against a possible ${top.potential}, with ${top.headroom}% still unclaimed across ${top.keywords} keywords.`,
      evidence: stalled
        .slice(0, 4)
        .map((row) => `${row.label} — ${Math.round(row.potential - row.traffic)} sessions available`),
      recommendation: `Point the next planning cycle at ${top.label}. The demand is measured; the coverage is not there yet.`,
      owner: "seo-director",
      href: `/keywords?project=${projectId}`,
      confidence: "medium",
      provenance: "derived",
    });
  }

  // -- what attribution can and cannot say --------------------------------
  if (attribution.length >= 5) {
    const strong = attribution.filter(
      (entry) => entry.confidence === "medium",
    );
    const meanAssociation = Math.round(
      mean(attribution.map((entry) => entry.association)),
    );

    out.push({
      id: `learning-${projectId}-attribution`,
      projectId,
      projectName,
      verdict: "watch",
      headline: `${attribution.length} pieces of work sit beside movement this window`,
      observation: `${strong.length} of them are on the same page as the movement, at a mean association of ${meanAssociation} out of 100. None of it establishes cause — there is no holdout in this dataset.`,
      evidence: attribution
        .slice(0, 3)
        .map((entry) => `${entry.workTitle} — ${entry.outcomeLabel}`),
      recommendation:
        "Treat these as the shortlist worth measuring properly, not as results. A controlled before-and-after on two or three of them would be worth more than the whole list.",
      owner: "analytics-learning",
      href: `/analytics?project=${projectId}&tab=attribution`,
      confidence: "low",
      provenance: "derived",
    });
  }

  // -- anomalies nothing explains ----------------------------------------
  const unexplained = anomalies.filter(
    (anomaly) => anomaly.explanation === null && anomaly.significance === "material",
  );
  if (unexplained.length > 0) {
    out.push({
      id: `learning-${projectId}-unexplained`,
      projectId,
      projectName,
      verdict: "investigate",
      headline: `${unexplained.length} material ${unexplained.length === 1 ? "movement has" : "movements have"} no explanation`,
      observation:
        "These moved enough to matter, and no finding in Technical SEO, AI Visibility or the content records accounts for them.",
      evidence: unexplained.slice(0, 3).map((anomaly) => anomaly.finding),
      recommendation:
        "Look outside this product before acting: a seasonal shift, a SERP layout change, or a competitor move would all look like this and none of them is visible here.",
      owner: "analytics-learning",
      href: `/analytics?project=${projectId}&tab=anomalies`,
      confidence: "none",
      provenance: "derived",
    });
  }

  return out;
}
