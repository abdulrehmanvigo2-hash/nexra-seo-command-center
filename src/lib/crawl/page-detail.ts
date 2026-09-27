/**
 * One recorded page, as plain data for the live page-detail route (Phase 3,
 * checkpoint 3.3).
 *
 * Everything here is what this product's crawler recorded for the page when
 * the crawl ran: how it answered, what it declared, what it carried and how
 * it linked. A reading the crawler did not establish is shown as unknown,
 * never as a zero or a pass; robots, canonical and sitemap readings are what
 * the page declared, never Google's index; and a page the crawl discovered
 * but never fetched shows only that.
 */

import { RULES } from "@/lib/crawl/findings/rules";
import { CATEGORY_LABEL, SEVERITY_LABEL, type Tone } from "@/lib/crawl/findings/present";
import { TRIAGE_STATUS_META, type FindingTriageStatus } from "@/lib/crawl/findings/triage/contract";
import { STATUS_LABEL, STOP_REASON } from "@/lib/crawl/panel-state";
import { pathOf } from "@/lib/crawl/pages-view";
import type { CrawlPageDetail } from "@/lib/crawl/service";
import type { CrawlLink } from "@/types/crawl";

export const UNKNOWN = "—";

export type Fact = { readonly label: string; readonly value: string; readonly title?: string };
export type FactGroup = { readonly id: string; readonly title: string; readonly note: string; readonly facts: readonly Fact[] };
export type EdgeRow = { readonly key: string; readonly url: string; readonly path: string; readonly anchor: string; readonly internal: boolean; readonly rel: string | null };
export type PageFindingRow = {
  readonly key: string;
  readonly severityLabel: string;
  readonly tone: Tone;
  readonly ruleLabel: string;
  readonly categoryLabel: string;
  readonly message: string;
  readonly statusLabel: string;
  readonly statusTone: Tone;
  /** Set when the finding names more pages than were stored with it. */
  readonly partialUrls: boolean;
};

export type PageDetailView = {
  readonly url: string;
  readonly path: string;
  readonly title: string;
  readonly fetched: boolean;
  readonly banner: string;
  readonly hostScope: string;
  readonly finishedAt: string | null;
  readonly groups: readonly FactGroup[];
  readonly inbound: readonly EdgeRow[];
  readonly outbound: readonly EdgeRow[];
  readonly linksNote: string;
  readonly findings: readonly PageFindingRow[];
  readonly findingsNote: string;
};

const text = (value: string | null) => (value === null || value.trim().length === 0 ? UNKNOWN : value);
const num = (value: number | null, unit = "") => (value === null ? UNKNOWN : `${value}${unit}`);
const bool = (value: boolean | null) => (value === null ? UNKNOWN : value ? "Yes" : "No");
const withLength = (value: string | null, length: number | null) => (value === null ? UNKNOWN : `${value} (${length ?? value.length} characters)`);

function edge(link: CrawlLink, side: "from" | "to", index: number): EdgeRow {
  const url = side === "from" ? link.fromUrl : link.toUrl;
  return { key: `${index}:${url}`, url, path: link.isInternal ? pathOf(url) : url, anchor: link.anchorText?.trim() ? link.anchorText.trim() : "(no anchor text)", internal: link.isInternal, rel: link.rel };
}

/** Builds the page-detail view from a found page. Pure. */
export function presentPageDetail(detail: Extract<CrawlPageDetail, { status: "found" }>): PageDetailView {
  const { crawl, page } = detail;
  const fetched = page.fetchState === "fetched";
  const reason = crawl.stopReason === null ? "still running" : STOP_REASON[crawl.stopReason].replace(/^./, (c) => c.toLowerCase());
  const pageState = fetched ? "this page was fetched and read" : page.fetchState === "budget-skipped" ? "this page was discovered, not fetched" : `this page was tried but not read (${page.fetchState})`;
  const banner = `Crawl ${crawl.id.slice(0, 8)} · ${STATUS_LABEL[crawl.status].label} — ${reason} · ${crawl.pagesFetched} of ${crawl.pagesDiscovered} discovered pages fetched · ${pageState}`;

  const response: FactGroup = {
    id: "response",
    title: "Response",
    note: "How the page answered this crawler's one fetch. Server response is crawler-measured, not a Core Web Vitals reading.",
    facts: [
      { label: "Fetch", value: page.fetchState === "budget-skipped" ? "not reached (budget)" : page.fetchState },
      { label: "HTTP status", value: num(page.httpStatus) },
      { label: "Final URL", value: text(page.finalUrl) },
      { label: "Redirect hops", value: fetched || page.redirectHops > 0 ? String(page.redirectHops) : UNKNOWN },
      { label: "Redirect chain", value: page.redirectChain.length === 0 ? "none recorded" : page.redirectChain.join(" → ") },
      { label: "Content type", value: text(page.contentType) },
      { label: "Server response, crawler-measured", value: num(page.responseMs, " ms") },
    ],
  };
  const indexing: FactGroup = {
    id: "indexing",
    title: "Declared indexing",
    note: "What the page and robots.txt declared to this crawler. Declared by the page — not whether Google indexed it.",
    facts: [
      { label: "Robots meta", value: text(page.robotsMeta) },
      { label: "X-Robots-Tag", value: text(page.xRobotsTag) },
      { label: "Declares noindex", value: bool(page.robotsNoindex) },
      { label: "Declares nofollow", value: bool(page.robotsNofollow) },
      { label: "robots.txt allows", value: bool(page.robotsTxtAllowed) },
      { label: "Canonical (as written)", value: text(page.canonicalHref) },
      { label: "Canonical (resolved)", value: text(page.canonicalResolved) },
      { label: "Canonical is this URL", value: bool(page.canonicalIsSelf) },
      { label: "Listed in the sitemap", value: bool(page.inSitemap) },
    ],
  };
  const markup: FactGroup = {
    id: "markup",
    title: "Metadata and markup",
    note: "What the page carried when it was fetched. Structured data is the types it declared; nothing here validates it.",
    facts: [
      { label: "Title", value: withLength(page.title, page.titleLength) },
      { label: "Meta description", value: withLength(page.metaDescription, page.metaDescriptionLength) },
      { label: "First H1", value: text(page.firstH1) },
      { label: "H1 / H2 / H3", value: `${num(page.h1Count)} / ${num(page.h2Count)} / ${num(page.h3Count)}` },
      { label: "Word count", value: num(page.wordCount) },
      { label: "html lang", value: text(page.htmlLang) },
      { label: "hreflang (malformed)", value: page.hreflangCount === null ? UNKNOWN : `${page.hreflangCount} (${num(page.hreflangMalformed)})` },
      { label: "Open Graph tags", value: num(page.ogTagCount) },
      { label: "og:title", value: text(page.ogTitle) },
      { label: "og:image", value: text(page.ogImage) },
      { label: "Twitter card", value: text(page.twitterCard) },
      { label: "Images (without alt)", value: page.imageCount === null ? UNKNOWN : `${page.imageCount} (${num(page.imagesWithoutAlt)})` },
      { label: "Detected structured data types", value: page.schemaTypes.length === 0 ? (fetched ? "none detected" : UNKNOWN) : page.schemaTypes.join(", ") },
      { label: "Structured data blocks (parse failed)", value: fetched ? `${page.schemaBlocks} (${page.schemaParseFailed ? "yes" : "no"})` : UNKNOWN },
    ],
  };
  const linking: FactGroup = {
    id: "linking",
    title: "Linking",
    note: "Counted within this crawl: links between the pages it fetched.",
    facts: [
      { label: "Depth from the start URL", value: num(page.depth) },
      { label: "Internal links in (from fetched pages)", value: fetched ? String(page.internalLinksIn) : UNKNOWN },
      { label: "Internal links out", value: fetched ? String(page.internalLinksOut) : UNKNOWN },
    ],
  };

  const triageByKey = new Map(detail.triage.map((d) => [d.findingKey, d.status]));
  const findings = detail.findings.map((f): PageFindingRow => {
    const status: FindingTriageStatus = triageByKey.get(f.id) ?? "open";
    return {
      key: f.id,
      severityLabel: SEVERITY_LABEL[f.severity].label,
      tone: SEVERITY_LABEL[f.severity].tone,
      ruleLabel: RULES[f.rule].label,
      categoryLabel: CATEGORY_LABEL[f.category],
      message: f.message,
      statusLabel: TRIAGE_STATUS_META[status].label,
      statusTone: TRIAGE_STATUS_META[status].tone,
      partialUrls: f.urlCount > f.urls.length,
    };
  });
  const findingsNote =
    detail.report.status === "recorded"
      ? findings.length === 0
        ? fetched
          ? "No recorded finding names this page. That is not a clean result for the page; only fixed rules over this crawl were applied."
          : "The page was not fetched, so no rule looked at it."
        : "Findings recorded when the crawl finished that name this page, with the decision recorded against each."
      : detail.report.status === "other-rules"
        ? `Findings for this crawl were recorded under rule version ${detail.report.ruleVersion}, not the current rules, so none are shown.`
        : "No findings were recorded for this crawl. Nothing is inferred in their place.";

  return {
    url: page.url,
    path: pathOf(page.url),
    title: page.title ?? pathOf(page.url),
    fetched,
    banner,
    hostScope: crawl.hostScope,
    finishedAt: crawl.finishedAt,
    groups: fetched ? [response, indexing, markup, linking] : [response],
    inbound: detail.inbound.map((l, i) => edge(l, "from", i)),
    outbound: detail.outbound.map((l, i) => edge(l, "to", i)),
    linksNote: `Recorded edges only: links found on the pages this crawl fetched, never fetched to check them.${detail.linksCut ? " The edge read reached its limit, so some edges may be missing." : ""}`,
    findings,
    findingsNote,
  };
}
