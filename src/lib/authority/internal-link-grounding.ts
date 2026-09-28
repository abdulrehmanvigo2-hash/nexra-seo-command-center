import { pathOf } from "@/lib/authority/link-grounding";
import type { JsonObject } from "@/types/agent-run";
import type { Crawl, CrawlLink, CrawlPage } from "@/types/crawl";

/**
 * The internal link structure one own-site crawl recorded, serialised for
 * the Authority & Backlink agent's internal-link review (Phase 6, checkpoint
 * 6.6, decision Q4 option B: Authority reads outbound and internal link
 * structure, never backlinks).
 *
 * Appended after the outbound link record, from the same edges, read once.
 * For each fetched page: how many internal edges from the other fetched
 * pages point at it, from which source paths, and with which anchor text as
 * recorded — the fewest first, since that is the end the review is about.
 * Counts are within this crawl only; a page with none is "no inbound link
 * from the fetched pages", never "orphaned". Bounded by pages, sources,
 * anchors and bytes. Pure.
 */

export const INTERNAL_TARGETS_MAX = 30;
export const INTERNAL_SOURCES_SHOWN = 3;
export const INTERNAL_ANCHORS_SHOWN = 3;
export const INTERNAL_LINK_MAX_BYTES = 8_000;
const ANCHOR_MAX = 80;

const encoder = new TextEncoder();
const bytesOf = (text: string) => encoder.encode(text).length;

/** A URL as the crawl may spell a page and an edge: no fragment, no trailing slash except the root's. */
const comparable = (url: string) => {
  const bare = url.split("#")[0];
  return /^[a-z]+:\/\/[^/]+\/$/i.test(bare) ? bare : bare.replace(/\/+$/, "");
};

const quote = (text: string) => {
  const characters = Array.from(text.replace(/\s+/g, " ").trim());
  return JSON.stringify(characters.length > ANCHOR_MAX ? `${characters.slice(0, ANCHOR_MAX).join("")}…` : characters.join(""));
};

const HEADING = "INTERNAL LINK STRUCTURE (edges between the project's own fetched pages, recorded by this crawl; within this crawl only)";
export const INTERNAL_LINK_LIMITS_NOTE = [
  "LIMITS OF THIS INTERNAL LINK RECORD",
  "- Counts are edges from this crawl's fetched pages only. A page with no inbound link here may be linked from pages the crawl did not reach: it is not shown to be orphaned.",
  "- Anchor text is as recorded; 'not recorded' means the edge predates anchor recording or the anchor carried no text, never that the link has none.",
  "- Nothing here measures authority, PageRank, crawl budget, indexation or any external link.",
].join("\n");

type Target = { readonly url: string; readonly sources: Set<string>; readonly anchors: string[]; anchorsUnrecorded: number };

export function formatInternalLinkGrounding(crawl: Crawl, pages: readonly CrawlPage[], links: readonly CrawlLink[], readLimitHit: boolean): { readonly text: string; readonly summary: JsonObject } {
  const fetched = pages.filter((page) => page.fetchState === "fetched");
  const targets = new Map<string, Target>();
  for (const page of fetched) targets.set(comparable(page.url), { url: page.url, sources: new Set(), anchors: [], anchorsUnrecorded: 0 });

  const internal = links.filter((link) => link.isInternal);
  for (const link of internal) {
    const target = targets.get(comparable(link.toUrl));
    if (target === undefined || comparable(link.fromUrl) === comparable(link.toUrl)) continue;
    target.sources.add(link.fromUrl);
    const anchor = link.anchorText?.trim() ?? "";
    if (anchor.length === 0) target.anchorsUnrecorded += 1;
    else if (!target.anchors.includes(anchor)) target.anchors.push(anchor);
  }

  const ordered = [...targets.values()].sort((a, b) => a.sources.size - b.sources.size || a.url.localeCompare(b.url));
  const none = ordered.filter((t) => t.sources.size === 0).length;
  const header = [
    HEADING,
    `Crawl ${crawl.id}: ${fetched.length} fetched page${fetched.length === 1 ? "" : "s"}; ${internal.length} internal edge${internal.length === 1 ? "" : "s"} read${readLimitHit ? " (the read limit: a lower bound)" : ""}; ${none} fetched page${none === 1 ? "" : "s"} with no inbound link from the other fetched pages.`,
  ].join("\n");

  const lines: string[] = [];
  let bytes = bytesOf(header) + bytesOf(INTERNAL_LINK_LIMITS_NOTE) + 96;
  for (const target of ordered.slice(0, INTERNAL_TARGETS_MAX)) {
    const path = pathOf(target.url) ?? target.url;
    const sources = [...target.sources].slice(0, INTERNAL_SOURCES_SHOWN).map((s) => pathOf(s) ?? s);
    const anchors = target.anchors.slice(0, INTERNAL_ANCHORS_SHOWN).map(quote);
    const line =
      target.sources.size === 0
        ? `- ${path} — no inbound link from the fetched pages`
        : `- ${path} — ${target.sources.size} source page${target.sources.size === 1 ? "" : "s"} (${sources.join(", ")}${target.sources.size > sources.length ? ", …" : ""}); anchors ${anchors.length ? anchors.join(", ") : "not recorded"}${target.anchorsUnrecorded > 0 && anchors.length ? `; ${target.anchorsUnrecorded} edge(s) with no anchor recorded` : ""}`;
    if (bytes + bytesOf(line) + 1 > INTERNAL_LINK_MAX_BYTES) break;
    lines.push(line);
    bytes += bytesOf(line) + 1;
  }
  const cut = lines.length < ordered.length;
  const text = [
    header,
    ["PAGES BY INBOUND INTERNAL LINKS (fewest first)", ...(lines.length ? lines : ["- no fetched page"])].join("\n"),
    ...(cut ? [`(${lines.length} of ${ordered.length} fetched pages shown; the rest were left out to keep this block within its bound)`] : []),
    INTERNAL_LINK_LIMITS_NOTE,
  ].join("\n\n");
  return {
    text,
    summary: { internalLinks: "recorded", fetchedPages: fetched.length, internalEdges: internal.length, noInbound: none, shown: lines.length, truncated: cut || readLimitHit, bytes: bytesOf(text) },
  };
}
