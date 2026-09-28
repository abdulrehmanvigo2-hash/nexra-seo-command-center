import { groupQueryPageWindows, selectQueryPageWindows } from "@/lib/search-console/query-pages/select";
import { QUERY_PAGE_ROW_LIMIT, type StoredQueryPage } from "@/lib/search-console/query-pages/contract";
import type { JsonObject } from "@/types/agent-run";
import type { SearchQueryPageRow } from "@/types/search-console";

/**
 * The latest stored query × page window, listed by page, for the two tasks
 * that read pages beside the queries Google showed them for (Phase 6,
 * checkpoint 6.5: the Content Strategist's refresh review and the On-Page
 * agent's page–query alignment). Appended after one crawl's evidence.
 *
 * The P4c block names overlaps only; these tasks need each page's own pairs,
 * so this block groups the latest window's stored rows by page — the most
 * impressions first — and marks whether the crawl named fetched that page.
 * The same property rule as P4c: rows under another property are set aside,
 * never mixed in. Bounded (pages, queries per page, bytes); a missing,
 * unreadable or empty store is stated in one line, never as zero demand.
 * Pure: the server wiring reads the rows.
 */

export const PAGE_PAIR_MAX_PAGES = 8;
export const PAGE_PAIR_MAX_QUERIES = 5;
export const PAGE_PAIR_MAX_BYTES = 6_000;
const KEY_MAX = 200;

export type PagePairInput =
  | {
      readonly available: true;
      readonly startDate: string;
      readonly endDate: string;
      readonly rows: readonly SearchQueryPageRow[];
    }
  | { readonly available: false; readonly reason: "no-pairs" | "no-pairs-for-property" | "not-kept" | "read-failed" };

/** The latest window of the current property, from the stored rows the one bounded read returned. */
export function latestPagePairs(rows: readonly StoredQueryPage[], currentProperty: string, readLimit: number): PagePairInput {
  const selection = selectQueryPageWindows(groupQueryPageWindows(rows, readLimit), currentProperty);
  if (!selection.ok) return { available: false, reason: selection.reason };
  return { available: true, startDate: selection.latest.startDate, endDate: selection.latest.endDate, rows: selection.latest.rows };
}

/** A URL as the crawl and Search Console may each spell it: no fragment, no trailing slash except the root's. */
export function comparableUrl(url: string): string {
  const bare = url.split("#")[0];
  return /^[a-z]+:\/\/[^/]+\/$/i.test(bare) ? bare : bare.replace(/\/+$/, "");
}

const quote = (key: string) => {
  const characters = Array.from(key.replace(/\s+/g, " ").trim());
  return JSON.stringify(characters.length > KEY_MAX ? `${characters.slice(0, KEY_MAX).join("")}…` : characters.join(""));
};

const encoder = new TextEncoder();
const bytesOf = (text: string) => encoder.encode(text).length;

const HEADING = "STORED QUERY × PAGE PAIRS BY PAGE (rows this product recorded from Google Search Console for one 30-day window; what Google showed, not rankings)";
const LIMITS = [
  "LIMITS OF THESE PAIRS",
  `- Google's top ${QUERY_PAGE_ROW_LIMIT} query × page rows by clicks for the window; anonymised queries are absent, so a page with no pair here is unobserved, not without demand.`,
  "- Average position is Search Console's impression-weighted average, not a rank. A query shown on two pages is a potential overlap for review, never confirmed cannibalisation.",
].join("\n");

const REASON_LINE: Readonly<Record<Extract<PagePairInput, { available: false }>["reason"], string>> = {
  "no-pairs": "No query × page pairs are stored for this project yet: no page can be matched to a query.",
  "no-pairs-for-property": "Stored pairs exist only under a Search Console property this project no longer maps to; they describe another site and are set aside.",
  "not-kept": "Query × page pairs are not kept on this deployment.",
  "read-failed": "The stored query × page pairs could not be read for this run; nothing is inferred in their place.",
};

export type PagePairGrounding = {
  readonly text: string;
  readonly summary: JsonObject;
};

/** The block, with each page marked fetched or not by the crawl whose fetched URLs are given. */
export function formatPagePairGrounding(input: PagePairInput, fetchedUrls: readonly string[]): PagePairGrounding {
  if (!input.available) {
    return { text: `${HEADING}\n${REASON_LINE[input.reason]}`, summary: { pagePairs: input.reason, pages: 0, pairs: 0, onFetchedPages: 0, truncated: false } };
  }
  const fetched = new Set(fetchedUrls.map(comparableUrl));
  const byPage = new Map<string, SearchQueryPageRow[]>();
  for (const row of input.rows) {
    const list = byPage.get(row.page);
    if (list) list.push(row);
    else byPage.set(row.page, [row]);
  }
  const impressions = (rows: readonly SearchQueryPageRow[]) => rows.reduce((n, r) => n + r.impressions, 0);
  const pages = [...byPage.entries()].sort((a, b) => impressions(b[1]) - impressions(a[1]) || a[0].localeCompare(b[0]));
  const onFetched = input.rows.filter((r) => fetched.has(comparableUrl(r.page))).length;

  const header = [
    HEADING,
    `Window ${input.startDate} to ${input.endDate}: ${input.rows.length} pairs over ${pages.length} pages; ${onFetched} of the pairs name a page this crawl fetched.`,
  ].join("\n");

  const sections: string[] = [];
  let bytes = bytesOf(header) + bytesOf(LIMITS) + 64;
  let truncated = pages.length > PAGE_PAIR_MAX_PAGES;
  for (const [page, rows] of pages.slice(0, PAGE_PAIR_MAX_PAGES)) {
    const shown = [...rows].sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.query.localeCompare(b.query)).slice(0, PAGE_PAIR_MAX_QUERIES);
    const section = [
      `- Page ${quote(page)} — ${fetched.has(comparableUrl(page)) ? "fetched by this crawl" : "not fetched by this crawl"}; ${impressions(rows)} impressions over ${rows.length} ${rows.length === 1 ? "query" : "queries"}${shown.length < rows.length ? `, ${shown.length} shown` : ""}`,
      ...shown.map((r) => `    · query ${quote(r.query)} — impressions ${r.impressions}, clicks ${r.clicks}, CTR ${(r.ctr * 100).toFixed(2)}%, average position ${r.position.toFixed(1)}`),
    ].join("\n");
    if (bytes + bytesOf(section) + 1 > PAGE_PAIR_MAX_BYTES) {
      truncated = true;
      break;
    }
    sections.push(section);
    bytes += bytesOf(section) + 1;
  }

  const text = [header, sections.length ? sections.join("\n") : "- none", ...(truncated ? ["(further pages were left out to keep this block within its bound)"] : []), LIMITS].join("\n\n");
  return {
    text,
    summary: { pagePairs: "available", endDate: input.endDate, pages: pages.length, pairs: input.rows.length, onFetchedPages: onFetched, shownPages: sections.length, truncated, bytes: bytesOf(text) },
  };
}
