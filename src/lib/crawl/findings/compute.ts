import { createHash } from "node:crypto";
import {
  FINDINGS_LIMITATIONS,
  FINDINGS_RULE_VERSION,
  MAX_FINDINGS_PER_RULE,
  MAX_URLS_PER_FINDING,
  type CrawlFinding,
  type CrawlFindingsCoverage,
  type CrawlFindingsReport,
  type FindingRuleId,
  type ObservedValue,
} from "@/lib/crawl/findings/contract";
import {
  DEEP_PAGE_DEPTH,
  isGenericAnchorText,
  META_DESCRIPTION_MAX_LENGTH,
  metaForbidsIndexing,
  normaliseAnchorText,
  normaliseText,
  REDIRECT_CHAIN_MIN_HOPS,
  RULES,
  SEVERITY_RANK,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from "@/lib/crawl/findings/rules";
import { groupPages } from "@/lib/crawl/pages-view";
import type { Crawl, CrawlFetchState, CrawlLink, CrawlPage } from "@/types/crawl";

/**
 * The rules, applied to one crawl. Pure: no I/O, no clock, no randomness.
 *
 * Every rule reads only fields the crawl recorded, and only where they are
 * known: a null title, status, depth or sitemap flag is unknown and yields
 * nothing. Content rules (titles, descriptions, headings, canonicals, schema)
 * look only at pages that were fetched and read; HTTP and redirect rules at
 * the pages whose fetch ended that way; link rules only at edges whose
 * target is a page this crawl fetched. Duplicate checks exclude pages that
 * canonicalise elsewhere or say noindex, because a duplicate there is what
 * the page itself declares.
 */

export type CrawlFindingsInput = {
  readonly crawl: Crawl;
  readonly pages: readonly CrawlPage[];
  readonly links: readonly CrawlLink[];
};

type Draft = {
  readonly rule: FindingRuleId;
  readonly urls: readonly string[];
  readonly observed: Readonly<Record<string, ObservedValue>>;
  readonly message: string;
  /** For a rule whose URLs alone do not identify the finding (a broken link's target): part of the id. */
  readonly key?: string;
};

const byUrl = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function findingId(rule: FindingRuleId, urls: readonly string[], key?: string): string {
  const subject = key === undefined ? `${rule}\n${urls.join("\n")}` : `${rule}\n${key}\n${urls.join("\n")}`;
  const digest = createHash("sha256").update(subject, "utf8").digest("hex").slice(0, 16);
  return `${rule}:${digest}`;
}

function finalise(draft: Draft): CrawlFinding {
  const urls = [...draft.urls].sort(byUrl);
  const meta = RULES[draft.rule];
  return {
    id: findingId(draft.rule, urls, draft.key),
    rule: draft.rule,
    category: meta.category,
    severity: meta.severity,
    urls: urls.slice(0, MAX_URLS_PER_FINDING),
    urlCount: urls.length,
    observed: draft.observed,
    message: draft.message,
  };
}

const isHtml = (page: CrawlPage) => page.contentType === null || /html/i.test(page.contentType);
const errorStatus = (page: CrawlPage) => page.httpStatus !== null && page.httpStatus >= 400;

/** Pages that were fetched and read as HTML: the only ones whose content fields mean anything. */
function readable(pages: readonly CrawlPage[]): readonly CrawlPage[] {
  return pages.filter((page) => page.fetchState === "fetched" && isHtml(page));
}

function perPage(rule: FindingRuleId, page: CrawlPage, observed: Record<string, ObservedValue>, message: string): Draft {
  return { rule, urls: [page.url], observed, message };
}

function duplicates(
  rule: FindingRuleId,
  pages: readonly CrawlPage[],
  read: (page: CrawlPage) => string | null,
  field: "title" | "metaDescription",
  what: string,
): Draft[] {
  const groups = new Map<string, CrawlPage[]>();
  for (const page of pages) {
    if (page.canonicalIsSelf === false || metaForbidsIndexing(page.robotsMeta) || page.robotsNoindex === true) continue;
    const value = normaliseText(read(page));
    if (value === "") continue;
    (groups.get(value) ?? groups.set(value, []).get(value)!).push(page);
  }
  const drafts: Draft[] = [];
  for (const [value, members] of groups) {
    if (members.length < 2) continue;
    drafts.push({
      rule,
      urls: members.map((page) => page.url),
      observed: { [field]: value, pages: members.length },
      message: `${members.length} fetched pages share the same ${what}.`,
    });
  }
  return drafts;
}

function contentRules(pages: readonly CrawlPage[]): Draft[] {
  const drafts: Draft[] = [];
  for (const page of pages) {
    const title = normaliseText(page.title);
    if (page.title !== null || page.titleLength !== null) {
      if (title === "") drafts.push(perPage("title-missing", page, { title: page.title }, "The page has no title."));
      else if (page.titleLength !== null && page.titleLength < TITLE_MIN_LENGTH) {
        drafts.push(perPage("title-short", page, { title: page.title, titleLength: page.titleLength }, `The title is ${page.titleLength} characters, under ${TITLE_MIN_LENGTH}.`));
      } else if (page.titleLength !== null && page.titleLength > TITLE_MAX_LENGTH) {
        drafts.push(perPage("title-long", page, { title: page.title, titleLength: page.titleLength }, `The title is ${page.titleLength} characters, over ${TITLE_MAX_LENGTH}.`));
      }
    }

    const description = normaliseText(page.metaDescription);
    if (page.metaDescription !== null || page.metaDescriptionLength !== null) {
      if (description === "") {
        drafts.push(perPage("meta-description-missing", page, { metaDescription: page.metaDescription }, "The page has no meta description."));
      } else if (page.metaDescriptionLength !== null && page.metaDescriptionLength > META_DESCRIPTION_MAX_LENGTH) {
        drafts.push(perPage("meta-description-long", page, { metaDescription: page.metaDescription, metaDescriptionLength: page.metaDescriptionLength }, `The meta description is ${page.metaDescriptionLength} characters, over ${META_DESCRIPTION_MAX_LENGTH}.`));
      }
    }

    if (page.h1Count !== null) {
      if (page.h1Count === 0) drafts.push(perPage("h1-missing", page, { h1Count: 0 }, "The page has no H1."));
      else if (page.h1Count > 1) drafts.push(perPage("h1-multiple", page, { h1Count: page.h1Count, firstH1: page.firstH1 }, `The page has ${page.h1Count} H1 headings.`));
    }

    // Both counts come from one reading of the page; a page recorded before
    // they were kept has neither and yields nothing.
    if (page.h2Count !== null && page.h3Count !== null && page.h2Count === 0 && page.h3Count > 0) {
      drafts.push(perPage("heading-h3-without-h2", page, { h1Count: page.h1Count, h2Count: 0, h3Count: page.h3Count }, `The page has ${page.h3Count} H3 heading(s) and no H2.`));
    }
    if (page.imageCount !== null && page.imagesWithoutAlt !== null && page.imagesWithoutAlt > 0) {
      drafts.push(perPage("image-alt-missing", page, { imageCount: page.imageCount, imagesWithoutAlt: page.imagesWithoutAlt }, `${page.imagesWithoutAlt} of ${page.imageCount} images on the page have no alt attribute.`));
    }

    if (page.canonicalHref !== null && page.canonicalResolved === null) {
      drafts.push(perPage("canonical-unresolvable", page, { canonicalHref: page.canonicalHref }, "The canonical link could not be resolved to a URL."));
    } else if (page.canonicalIsSelf === false && page.canonicalResolved !== null) {
      drafts.push(perPage("canonical-elsewhere", page, { canonicalHref: page.canonicalHref, canonicalResolved: page.canonicalResolved, finalUrl: page.finalUrl }, "The page declares a canonical URL other than itself."));
    }

    if (page.schemaParseFailed) {
      drafts.push(perPage("schema-parse-failed", page, { schemaBlocks: page.schemaBlocks, schemaParseFailed: true }, "A JSON-LD block on the page could not be parsed."));
    } else if (page.schemaBlocks === 0) {
      drafts.push(perPage("schema-missing", page, { schemaBlocks: 0 }, "The page carries no JSON-LD."));
    }
  }
  drafts.push(...duplicates("title-duplicate", pages, (page) => page.title, "title", "title"));
  drafts.push(...duplicates("meta-description-duplicate", pages, (page) => page.metaDescription, "metaDescription", "meta description"));
  return drafts;
}

function canonicalTargetRules(pages: readonly CrawlPage[], byPageUrl: ReadonlyMap<string, CrawlPage>): Draft[] {
  const drafts: Draft[] = [];
  for (const page of pages) {
    if (page.canonicalIsSelf !== false || page.canonicalResolved === null) continue;
    const target = byPageUrl.get(page.canonicalResolved);
    if (!target || target.httpStatus === null || !errorStatus(target)) continue;
    drafts.push({
      rule: "canonical-target-error",
      urls: [page.url],
      observed: { canonicalResolved: page.canonicalResolved, targetHttpStatus: target.httpStatus, targetFetchState: target.fetchState },
      message: `The canonical target answered ${target.httpStatus} in this crawl.`,
    });
  }
  return drafts;
}

function httpAndRedirectRules(pages: readonly CrawlPage[]): Draft[] {
  const drafts: Draft[] = [];
  for (const page of pages) {
    if (page.fetchState === "budget-skipped") continue;
    if (page.httpStatus !== null && page.httpStatus >= 500) {
      drafts.push(perPage("http-server-error", page, { httpStatus: page.httpStatus, fetchState: page.fetchState }, `The page answered ${page.httpStatus}.`));
    } else if (page.httpStatus !== null && page.httpStatus >= 400) {
      drafts.push(perPage("http-client-error", page, { httpStatus: page.httpStatus, fetchState: page.fetchState }, `The page answered ${page.httpStatus}.`));
    }
    if (page.fetchState === "redirect-loop" || page.fetchState === "too-many-redirects") {
      drafts.push(perPage("redirect-loop", page, { fetchState: page.fetchState, redirectHops: page.redirectHops, redirectChain: page.redirectChain.join(" -> ") }, `The fetch ended in ${page.fetchState} after ${page.redirectHops} hops.`));
    } else if (page.redirectHops >= REDIRECT_CHAIN_MIN_HOPS) {
      drafts.push(perPage("redirect-chain", page, { redirectHops: page.redirectHops, redirectChain: page.redirectChain.join(" -> "), finalUrl: page.finalUrl }, `The URL redirected ${page.redirectHops} times before answering.`));
    }
  }
  return drafts;
}

function linkRules(links: readonly CrawlLink[], byPageUrl: ReadonlyMap<string, CrawlPage>): Draft[] {
  // One finding per broken target, naming the pages that link to it.
  const sources = new Map<string, Set<string>>();
  for (const link of links) {
    if (!link.isInternal) continue;
    const target = byPageUrl.get(link.toUrl);
    if (!target || target.httpStatus === null || !errorStatus(target)) continue;
    (sources.get(link.toUrl) ?? sources.set(link.toUrl, new Set()).get(link.toUrl)!).add(link.fromUrl);
  }
  const drafts: Draft[] = [];
  for (const [toUrl, fromUrls] of sources) {
    const target = byPageUrl.get(toUrl)!;
    const from = [...fromUrls].sort(byUrl);
    drafts.push({
      rule: "internal-link-broken",
      urls: from,
      key: toUrl,
      observed: { toUrl, targetHttpStatus: target.httpStatus, targetFetchState: target.fetchState, linkingPages: from.length },
      message: `${from.length} crawled page(s) link to ${toUrl}, which answered ${target.httpStatus}.`,
    });
  }
  return drafts;
}

function indexabilityAndSitemapRules(pages: readonly CrawlPage[]): Draft[] {
  const drafts: Draft[] = [];
  for (const page of pages) {
    if (page.fetchState === "budget-skipped") continue;
    const disallowed = page.robotsTxtAllowed === false || page.fetchState === "blocked-by-robots";
    const noindex = page.fetchState === "fetched" && metaForbidsIndexing(page.robotsMeta);
    // The header is read off any response that answered (an error page saying
    // noindex is unremarkable); a page recorded before the header was kept
    // has null and yields nothing.
    const headerNoindex = page.httpStatus !== null && page.httpStatus < 400 && metaForbidsIndexing(page.xRobotsTag);
    if (disallowed) drafts.push(perPage("robots-txt-disallowed", page, { robotsTxtAllowed: page.robotsTxtAllowed, fetchState: page.fetchState }, "robots.txt disallows this URL for the crawler's user agent."));
    if (noindex) drafts.push(perPage("robots-meta-noindex", page, { robotsMeta: page.robotsMeta }, "The page's robots meta says noindex."));
    if (headerNoindex) drafts.push(perPage("robots-header-noindex", page, { xRobotsTag: page.xRobotsTag, robotsMeta: page.robotsMeta, httpStatus: page.httpStatus }, "The X-Robots-Tag response header says noindex."));

    if (page.inSitemap !== true) continue;
    if (noindex || headerNoindex) {
      drafts.push(perPage("sitemap-lists-noindex", page, { inSitemap: true, robotsMeta: page.robotsMeta, xRobotsTag: page.xRobotsTag }, `The sitemap lists a page whose ${noindex ? "robots meta" : "X-Robots-Tag header"} says noindex.`));
    }
    if (page.httpStatus !== null && errorStatus(page)) drafts.push(perPage("sitemap-lists-error", page, { inSitemap: true, httpStatus: page.httpStatus }, `The sitemap lists a page that answered ${page.httpStatus}.`));
    if (disallowed) drafts.push(perPage("sitemap-lists-blocked", page, { inSitemap: true, robotsTxtAllowed: page.robotsTxtAllowed }, "The sitemap lists a page robots.txt disallows."));
    if (page.canonicalIsSelf === false && page.canonicalResolved !== null) {
      drafts.push(perPage("sitemap-lists-canonicalised", page, { inSitemap: true, canonicalResolved: page.canonicalResolved }, "The sitemap lists a page whose canonical points elsewhere."));
    }
  }
  return drafts;
}

/**
 * Anchor text of the internal links each recorded page carries. Only edges
 * whose text was recorded take part (null is an edge from before T5), and
 * only from pages this crawl recorded; one finding per page and rule.
 */
function anchorRules(links: readonly CrawlLink[], byPageUrl: ReadonlyMap<string, CrawlPage>): Draft[] {
  const perSource = new Map<string, { checked: number; empty: number; generic: number; examples: Set<string> }>();
  for (const link of links) {
    if (!link.isInternal || link.anchorText === null || !byPageUrl.has(link.fromUrl)) continue;
    const entry = perSource.get(link.fromUrl) ?? { checked: 0, empty: 0, generic: 0, examples: new Set<string>() };
    perSource.set(link.fromUrl, entry);
    entry.checked += 1;
    if (normaliseText(link.anchorText) === "") entry.empty += 1;
    else if (isGenericAnchorText(link.anchorText)) {
      entry.generic += 1;
      if (entry.examples.size < 5) entry.examples.add(normaliseAnchorText(link.anchorText));
    }
  }
  const drafts: Draft[] = [];
  for (const [fromUrl, entry] of perSource) {
    const page = byPageUrl.get(fromUrl)!;
    if (entry.empty > 0) {
      drafts.push(perPage("link-anchor-empty", page, { emptyAnchors: entry.empty, internalLinksChecked: entry.checked }, `${entry.empty} of ${entry.checked} internal link(s) on the page have no anchor text and no image alt.`));
    }
    if (entry.generic > 0) {
      drafts.push(perPage("link-anchor-generic", page, { genericAnchors: entry.generic, internalLinksChecked: entry.checked, examples: [...entry.examples].sort().join(", ") }, `${entry.generic} of ${entry.checked} internal link(s) on the page use generic anchor text.`));
    }
  }
  return drafts;
}

function structureRules(pages: readonly CrawlPage[]): Draft[] {
  const drafts: Draft[] = [];
  for (const page of pages) {
    if (page.fetchState !== "fetched") continue;
    if (page.depth !== null && page.depth > DEEP_PAGE_DEPTH) {
      drafts.push(perPage("page-deep", page, { depth: page.depth }, `The page was reached at depth ${page.depth}, beyond ${DEEP_PAGE_DEPTH}.`));
    }
    if (page.depth !== null && page.depth > 0 && page.internalLinksIn === 0) {
      drafts.push(perPage("no-inbound-links-in-crawl", page, { depth: page.depth, internalLinksIn: 0, inSitemap: page.inSitemap }, "No crawled page links to this page; it was reached another way (for example the sitemap). This does not prove it is orphaned."));
    }
  }
  return drafts;
}

function coverageOf(crawl: Crawl, pages: readonly CrawlPage[], links: readonly CrawlLink[]): CrawlFindingsCoverage {
  const groups = groupPages(pages);
  const fetchStates: Partial<Record<CrawlFetchState, number>> = {};
  for (const page of pages) fetchStates[page.fetchState] = (fetchStates[page.fetchState] ?? 0) + 1;
  return {
    crawlId: crawl.id,
    hostScope: crawl.hostScope,
    status: crawl.status,
    stopReason: crawl.stopReason,
    robotsState: crawl.robotsState,
    sitemapState: crawl.sitemapState,
    pagesTotal: pages.length,
    pagesFetched: groups.fetched.length,
    pagesNotFetched: groups.notFetched.length,
    pagesNotReached: groups.notReached.length,
    linksTotal: links.length,
    fetchStates,
  };
}

function order(a: CrawlFinding, b: CrawlFinding): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) ||
    byUrl(a.urls[0] ?? "", b.urls[0] ?? "") ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function computeCrawlFindings(input: CrawlFindingsInput): CrawlFindingsReport {
  const { crawl, links } = input;
  // Only this crawl's rows take part, whatever the caller handed in.
  const pages = input.pages.filter((page) => page.crawlId === crawl.id);
  const ownLinks = links.filter((link) => link.crawlId === crawl.id);
  const byPageUrl = new Map(pages.map((page) => [page.url, page] as const));
  const content = readable(pages);

  const drafts: Draft[] = [
    ...contentRules(content),
    ...canonicalTargetRules(content, byPageUrl),
    ...httpAndRedirectRules(pages),
    ...linkRules(ownLinks, byPageUrl),
    ...anchorRules(ownLinks, byPageUrl),
    ...indexabilityAndSitemapRules(pages),
    ...structureRules(pages),
  ];

  const all = drafts.map(finalise).sort(order);
  const counts: Partial<Record<FindingRuleId, number>> = {};
  const kept: CrawlFinding[] = [];
  const truncatedRules = new Set<FindingRuleId>();
  for (const finding of all) {
    const seen = (counts[finding.rule] ?? 0) + 1;
    counts[finding.rule] = seen;
    if (seen <= MAX_FINDINGS_PER_RULE) kept.push(finding);
    else truncatedRules.add(finding.rule);
  }

  return {
    ruleVersion: FINDINGS_RULE_VERSION,
    coverage: coverageOf(crawl, pages, ownLinks),
    findings: kept,
    counts,
    truncatedRules: [...truncatedRules].sort(),
    limitations: FINDINGS_LIMITATIONS,
  };
}
