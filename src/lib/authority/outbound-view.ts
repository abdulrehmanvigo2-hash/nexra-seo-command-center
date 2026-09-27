/**
 * The Outbound Links screen over stored crawls (Phase 4, checkpoint 4.5,
 * decision Q4).
 *
 * The external edges the project's latest own-site crawl recorded, grouped
 * by target host: how many edges point there, the `rel` values as written,
 * the source paths on the project's own pages and the anchor texts. That is
 * all this product knows about links, and it points one way — what the
 * project's pages link to. There is no backlink, referring domain, inbound
 * anchor, authority figure or toxicity reading here, because nothing records
 * one. Pure and client-safe; the latest-outbound route hands in the edges.
 */

import { pathOf } from "@/lib/crawl/pages-view";
import type { Crawl, CrawlLink } from "@/types/crawl";

export const OUTBOUND_HEADER = "Outbound only — links from our pages, not backlinks";
export const OUTBOUND_NOTE =
  "Every edge here was found on the project's own pages by this product's crawler; the target was recorded and never fetched. Nothing here says who links to the project.";

/** The most hosts one view lists; the rest are counted. */
export const OUTBOUND_HOST_LIMIT = 50;
/** The most distinct anchor texts or source paths kept per host. */
export const OUTBOUND_DETAIL_LIMIT = 20;

export type OutboundHost = {
  readonly host: string;
  readonly edges: number;
  /** Each distinct `rel` as written ("none" when the anchor had no rel), with its edge count, largest first. */
  readonly rels: readonly { readonly rel: string; readonly edges: number }[];
  /** Distinct source paths on the project's pages, sorted. */
  readonly sources: readonly string[];
  /** Distinct anchor texts, sorted; an empty anchor and one recorded before anchor text are counted apart. */
  readonly anchors: readonly string[];
  readonly emptyAnchors: number;
  readonly unrecordedAnchors: number;
};

export type OutboundView = {
  readonly externalEdges: number;
  readonly hosts: readonly OutboundHost[];
  readonly moreHosts: number;
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const NONE = "none";

export function presentOutbound(links: readonly CrawlLink[]): OutboundView {
  const external = links.filter((link) => !link.isInternal);
  const byHost = new Map<string, CrawlLink[]>();
  for (const link of external) {
    const host = hostOf(link.toUrl) ?? link.toUrl;
    const list = byHost.get(host) ?? [];
    list.push(link);
    byHost.set(host, list);
  }
  const hosts = [...byHost.entries()]
    .map(([host, edges]) => {
      const rels = new Map<string, number>();
      for (const edge of edges) {
        const rel = edge.rel === null || edge.rel.trim() === "" ? NONE : edge.rel.trim().toLowerCase().split(/\s+/).sort().join(" ");
        rels.set(rel, (rels.get(rel) ?? 0) + 1);
      }
      const anchors = new Set<string>();
      let emptyAnchors = 0;
      let unrecordedAnchors = 0;
      for (const edge of edges) {
        if (edge.anchorText === null) unrecordedAnchors += 1;
        else if (edge.anchorText.trim() === "") emptyAnchors += 1;
        else anchors.add(edge.anchorText);
      }
      return {
        host,
        edges: edges.length,
        rels: [...rels.entries()].map(([rel, count]) => ({ rel, edges: count })).sort((a, b) => b.edges - a.edges || a.rel.localeCompare(b.rel)),
        sources: [...new Set(edges.map((edge) => pathOf(edge.fromUrl)))].sort().slice(0, OUTBOUND_DETAIL_LIMIT),
        anchors: [...anchors].sort().slice(0, OUTBOUND_DETAIL_LIMIT),
        emptyAnchors,
        unrecordedAnchors,
      };
    })
    .sort((a, b) => b.edges - a.edges || a.host.localeCompare(b.host));
  return { externalEdges: external.length, hosts: hosts.slice(0, OUTBOUND_HOST_LIMIT), moreHosts: Math.max(0, hosts.length - OUTBOUND_HOST_LIMIT) };
}

export type LatestOutbound =
  | { readonly status: "none" | "unavailable" }
  | {
      readonly status: "crawled";
      /** The crawl row, so the review control can decide whether it may queue. */
      readonly crawl: Crawl;
      readonly banner: string;
      /** Whether the edge read reached its bound, so edges may be missing. */
      readonly cut: boolean;
      readonly view: OutboundView;
    };

export function latestOutboundUrl(projectId: string): string {
  return `/api/crawls/latest-outbound?${new URLSearchParams({ project: projectId }).toString()}`;
}
