import { daysBefore, randInt, round } from "@/lib/mock/dashboard/core";
import { getKeywordRecords } from "@/lib/mock/keywords/builders";
import {
  CANNIBALIZATION_RISK_ORDER,
  ctrAt,
} from "@/lib/mock/keywords/meta";
import type {
  CannibalizationRecord,
  CannibalizationRisk,
  CannibalizationUrl,
  KeywordRecord,
} from "@/types/keyword";

/**
 * Keywords where more than one of our own pages is ranking.
 *
 * Read straight off the registry: a keyword carries the other pages competing
 * for it, and everything else here follows from the positions those pages hold.
 * The traffic split is not authored — each page's share is its own
 * click-through rate as a proportion of the total, so the percentages always
 * add up and always agree with the positions beside them.
 *
 * "Lost traffic" is the difference between what the split earns today and what
 * a single consolidated page would earn a few places higher. It is an
 * argument, not a measurement, and the module presents it as one.
 *
 * The controls this feeds — assigning a primary URL, queueing a consolidation,
 * marking a case reviewed — change frontend state only. Nothing here edits a
 * site, issues a redirect, or creates a task (CLAUDE.md §4).
 */

/** What kind of page a URL is, from its path. */
function pageTypeOf(url: string): string {
  if (url.startsWith("/blog/")) return "Blog post";
  if (url.startsWith("/guides/") || url.startsWith("/learn/")) return "Guide";
  if (url.startsWith("/explainers/")) return "Explainer";
  if (url.startsWith("/shop/") || url.startsWith("/products/")) {
    return "Category page";
  }
  if (url.startsWith("/compare/") || url.startsWith("/reviews/")) {
    return "Comparison page";
  }
  if (url.startsWith("/services/")) return "Service page";
  if (url.startsWith("/resources/")) return "Resource";
  if (url.startsWith("/market/")) return "Market report";
  if (url.startsWith("/platform/")) return "Product page";
  if (url.startsWith("/clinics/")) return "Location page";
  return "Landing page";
}

/**
 * Risk of a split.
 *
 * More pages is worse, and the same split on a head term costs more than on a
 * long-tail one — so volume moves the reading a band in either direction.
 */
function riskOf(record: KeywordRecord): CannibalizationRisk {
  const base: CannibalizationRisk =
    record.competingUrls.length >= 2 ? "high" : "medium";

  const index = CANNIBALIZATION_RISK_ORDER.indexOf(base);
  const shift = record.volume >= 15_000 ? -1 : record.volume < 5_000 ? 1 : 0;

  return CANNIBALIZATION_RISK_ORDER[
    Math.min(
      Math.max(index + shift, 0),
      CANNIBALIZATION_RISK_ORDER.length - 1,
    )
  ];
}

function resolutionFor(
  risk: CannibalizationRisk,
  primary: CannibalizationUrl,
  others: readonly CannibalizationUrl[],
): string {
  const other = others[0];

  switch (risk) {
    case "critical":
      return `Consolidate ${others.length === 1 ? other.url : `${others.length} pages`} into ${primary.url}, merge the unique sections, and redirect.`;
    case "high":
      return `Redirect ${other.url} into ${primary.url} and re-point the internal links that still target it.`;
    case "medium":
      return `Separate the two by intent — ${primary.url} keeps the query, ${other.url} narrows to its own.`;
    case "low":
      return `Leave both pages, but point the internal anchors for this term at ${primary.url}.`;
  }
}

let cache: readonly CannibalizationRecord[] | null = null;

/** Every detected split, most severe first. */
export function getCannibalization(): readonly CannibalizationRecord[] {
  cache ??= build();
  return cache;
}

function build(): readonly CannibalizationRecord[] {
  const records: CannibalizationRecord[] = [];

  for (const record of getKeywordRecords()) {
    if (record.competingUrls.length === 0 || record.targetUrl === null) continue;

    const primaryPosition = record.position ?? 30;

    // Each competing page sits below the primary one, spread far enough apart
    // to read as separate results rather than a tie.
    const positions = [
      { url: record.targetUrl, position: primaryPosition },
      ...record.competingUrls.map((url, index) => ({
        url,
        position: Math.min(
          100,
          primaryPosition + randInt(record.seed, 61 + index, 4, 22),
        ),
      })),
    ];

    const traffic = positions.map(
      (entry) => (record.volume * ctrAt(entry.position)) / 100,
    );
    const total = traffic.reduce((carry, value) => carry + value, 0) || 1;

    const urls: readonly CannibalizationUrl[] = positions.map(
      (entry, index) => ({
        url: entry.url,
        position: entry.position,
        trafficShare: round((traffic[index] / total) * 100, 1),
        role: index === 0 ? "primary" : "competing",
        pageType: pageTypeOf(entry.url),
      }),
    );

    const best = Math.min(...positions.map((entry) => entry.position));
    const consolidated =
      (record.volume * ctrAt(Math.max(1, best - 3))) / 100;

    const risk = riskOf(record);

    records.push({
      id: `cannibal--${record.id}`,
      keywordId: record.id,
      keyword: record.keyword,
      projectId: record.projectId,
      projectName: record.projectName,
      intent: record.intent,
      volume: record.volume,
      urls,
      risk,
      lostTraffic: Math.max(0, Math.round(consolidated - total)),
      resolution: resolutionFor(risk, urls[0], urls.slice(1)),
      owner: "on-page-seo",
      detectedAt: daysBefore(randInt(record.seed, 62, 6, 74)),
    });
  }

  return records.sort(
    (a, b) =>
      CANNIBALIZATION_RISK_ORDER.indexOf(a.risk) -
        CANNIBALIZATION_RISK_ORDER.indexOf(b.risk) ||
      b.lostTraffic - a.lostTraffic,
  );
}

/**
 * Risk by keyword id.
 *
 * Built once so the table can colour and filter thousands of rows without
 * scanning the record list for each one.
 */
let riskIndex: ReadonlyMap<string, CannibalizationRisk> | null = null;

export function cannibalizationRiskIndex(): ReadonlyMap<
  string,
  CannibalizationRisk
> {
  riskIndex ??= new Map(
    getCannibalization().map((record) => [record.keywordId, record.risk]),
  );
  return riskIndex;
}

/** The split affecting one keyword, if there is one. */
export function cannibalizationForKeyword(
  keywordId: string,
): CannibalizationRecord | null {
  return (
    getCannibalization().find((record) => record.keywordId === keywordId) ??
    null
  );
}
