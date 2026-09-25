import type { Crawl, CrawlFetchState, CrawlStatus, CrawlStopReason } from "@/types/crawl";

/**
 * Deterministic crawl findings (Technical SEO + On-Page SEO, checkpoint T1).
 *
 * A finding is a fixed rule applied to what one crawl recorded: a page's
 * title, its status code, an edge between two of its pages. Nothing here is
 * a model's opinion, a guess about Google, a ranking or a vital. The same
 * crawl always yields the same findings in the same order with the same ids,
 * so a finding can later be stored, diffed and handed to an agent as
 * evidence it may cite by id.
 *
 * WHAT A FINDING IS NOT. It is not a site-wide claim: a crawl is bounded by
 * pages, depth and time, and every count is "within this crawl". It never
 * says a page is orphaned (only that no crawled page linked to it), never
 * says a page is or is not indexed, and never names an external URL as
 * broken (external targets are never fetched). A null field is unknown and
 * produces no finding.
 */

/**
 * Bumped whenever a rule is added or changed, so a report says which rules
 * produced it. Version 2 (T5) adds the image, heading-level, anchor-text and
 * X-Robots-Tag rules, and reads the header's noindex where version 1 read
 * the meta tag alone. Version 3 (M2) adds the html-lang, hreflang, social
 * metadata and thin-page rules over the M2 content signals.
 */
export const FINDINGS_RULE_VERSION = 3;

export type FindingCategory =
  | "metadata"
  | "headings"
  | "canonical"
  | "http"
  | "redirects"
  | "links"
  | "indexability"
  | "sitemap"
  | "structure"
  | "schema"
  | "images"
  | "content";

/** The same vocabulary the Technical screen uses, so the two can meet later. */
export type FindingSeverity = "critical" | "high" | "medium" | "low";

export type FindingRuleId =
  | "title-missing"
  | "title-short"
  | "title-long"
  | "title-duplicate"
  | "meta-description-missing"
  | "meta-description-long"
  | "meta-description-duplicate"
  | "h1-missing"
  | "h1-multiple"
  | "canonical-unresolvable"
  | "canonical-elsewhere"
  | "canonical-target-error"
  | "http-client-error"
  | "http-server-error"
  | "redirect-chain"
  | "redirect-loop"
  | "internal-link-broken"
  | "robots-txt-disallowed"
  | "robots-meta-noindex"
  | "sitemap-lists-noindex"
  | "sitemap-lists-error"
  | "sitemap-lists-blocked"
  | "sitemap-lists-canonicalised"
  | "page-deep"
  | "no-inbound-links-in-crawl"
  | "schema-missing"
  | "schema-parse-failed"
  | "robots-header-noindex"
  | "heading-h3-without-h2"
  | "image-alt-missing"
  | "link-anchor-empty"
  | "link-anchor-generic"
  | "html-lang-missing"
  | "hreflang-malformed"
  | "social-metadata-missing"
  | "thin-page-candidate";

/** JSON-safe scalars only: a finding must be storable and quotable as it is. */
export type ObservedValue = string | number | boolean | null;

export type CrawlFinding = {
  /** Stable across runs over the same crawl: rule plus a digest of the URLs it names. */
  readonly id: string;
  readonly rule: FindingRuleId;
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  /** The page or pages the finding is about, sorted, at most MAX_URLS_PER_FINDING. */
  readonly urls: readonly string[];
  /** How many URLs the finding is really about (urls may be cut). */
  readonly urlCount: number;
  /** Exactly what the crawl recorded that triggered the rule. */
  readonly observed: Readonly<Record<string, ObservedValue>>;
  /** One plain sentence, in terms of what was observed. */
  readonly message: string;
};

export type CrawlFindingsCoverage = {
  readonly crawlId: string;
  readonly hostScope: string;
  readonly status: CrawlStatus;
  readonly stopReason: CrawlStopReason | null;
  readonly robotsState: Crawl["robotsState"];
  readonly sitemapState: Crawl["sitemapState"];
  readonly pagesTotal: number;
  readonly pagesFetched: number;
  readonly pagesNotFetched: number;
  readonly pagesNotReached: number;
  readonly linksTotal: number;
  /** Pages by fetch state, so a reader can see what the rules could not look at. */
  readonly fetchStates: Readonly<Partial<Record<CrawlFetchState, number>>>;
};

export type CrawlFindingsReport = {
  readonly ruleVersion: typeof FINDINGS_RULE_VERSION;
  readonly coverage: CrawlFindingsCoverage;
  /** Sorted by severity, then rule, then first URL. */
  readonly findings: readonly CrawlFinding[];
  /** True totals per rule, before any per-rule cut. */
  readonly counts: Readonly<Partial<Record<FindingRuleId, number>>>;
  /** Rules whose findings were cut to MAX_FINDINGS_PER_RULE. */
  readonly truncatedRules: readonly FindingRuleId[];
  /** Fixed statements of what these findings cannot say. */
  readonly limitations: readonly string[];
};

export const MAX_URLS_PER_FINDING = 25;
export const MAX_FINDINGS_PER_RULE = 100;

export const FINDINGS_LIMITATIONS: readonly string[] = [
  "Every finding describes pages this crawl fetched, within its page, depth and time budget. Nothing here is a site-wide total or a full-site audit.",
  "No finding says whether Google has indexed, crawled or ranked a page. Indexation is Search Console's to report; a crawler cannot observe it.",
  "Link findings count only edges between pages this crawl recorded. A page with no observed inbound link is not proven to be orphaned; it may be linked from pages that were not crawled, from nofollow pages whose links are not recorded, or from outside the site.",
  "A broken internal link is reported only when the target page was fetched and answered with an error status. External links are never fetched and are never called broken.",
  "There are no Core Web Vitals, no search volume, no rankings and no traffic here. Title and description lengths are review thresholds, not search-engine rules.",
  "Image, heading-level and anchor-text findings describe what the page's markup carries: an image with no alt attribute at all (an empty alt is a deliberate marker and is not counted), an H3 on a page with no H2, an internal link with no text and no image alt, and an anchor whose text is one of a fixed generic list. They are review prompts, not measurements of how a page performs. A page recorded before these signals were kept yields none of them.",
  "Language, hreflang, social-metadata and thin-page findings describe the fetched HTML's head and visible text as served: a missing or empty html lang attribute, an alternate link whose hreflang is not a language tag or has no href, a page with no Open Graph and no Twitter card metadata, and a page whose visible word count is under a fixed review threshold. A thin-page candidate is a candidate for a person's review, not a judgement of quality, and the word count is over the markup as served, not a rendered page. None of these is a search-engine rule or a penalty. A page recorded before these signals were kept yields none of them.",
];
