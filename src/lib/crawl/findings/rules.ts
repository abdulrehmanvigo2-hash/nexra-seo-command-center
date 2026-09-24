import type { FindingCategory, FindingRuleId, FindingSeverity } from "@/lib/crawl/findings/contract";

/**
 * The fixed thresholds and the fixed vocabulary of every rule. Constants,
 * so a finding is the same on every run; review thresholds, not search
 * engine rules, and said so in the limitations.
 */

/** Title length, in characters, below which a title is called short and above which long. */
export const TITLE_MIN_LENGTH = 30;
export const TITLE_MAX_LENGTH = 60;
/** Meta description length above which it is called long. */
export const META_DESCRIPTION_MAX_LENGTH = 160;
/** Depth beyond which a page is called deep (the default crawl depth budget is 3). */
export const DEEP_PAGE_DEPTH = 3;
/** Redirect hops from which a redirect is called a chain. */
export const REDIRECT_CHAIN_MIN_HOPS = 2;

/**
 * Anchor texts that say nothing about their target. Compared after
 * whitespace collapse, lower-casing and stripping trailing punctuation; the
 * list is fixed so the finding is the same on every run.
 */
export const GENERIC_ANCHOR_TEXTS: readonly string[] = [
  "click here",
  "here",
  "read more",
  "more",
  "learn more",
  "link",
  "this",
  "this page",
  "continue",
  "continue reading",
  "see more",
  "view more",
  "details",
  "more info",
  "more information",
];

export type RuleMeta = {
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  readonly label: string;
};

export const RULES: Readonly<Record<FindingRuleId, RuleMeta>> = {
  "title-missing": { category: "metadata", severity: "high", label: "Missing title" },
  "title-short": { category: "metadata", severity: "low", label: "Short title" },
  "title-long": { category: "metadata", severity: "low", label: "Long title" },
  "title-duplicate": { category: "metadata", severity: "medium", label: "Duplicate title" },
  "meta-description-missing": { category: "metadata", severity: "medium", label: "Missing meta description" },
  "meta-description-long": { category: "metadata", severity: "low", label: "Long meta description" },
  "meta-description-duplicate": { category: "metadata", severity: "low", label: "Duplicate meta description" },
  "h1-missing": { category: "headings", severity: "medium", label: "Missing H1" },
  "h1-multiple": { category: "headings", severity: "low", label: "More than one H1" },
  "canonical-unresolvable": { category: "canonical", severity: "high", label: "Canonical could not be resolved" },
  "canonical-elsewhere": { category: "canonical", severity: "low", label: "Canonical points to another URL" },
  "canonical-target-error": { category: "canonical", severity: "high", label: "Canonical target answered with an error" },
  "http-client-error": { category: "http", severity: "high", label: "Client error (4xx)" },
  "http-server-error": { category: "http", severity: "critical", label: "Server error (5xx)" },
  "redirect-chain": { category: "redirects", severity: "medium", label: "Redirect chain" },
  "redirect-loop": { category: "redirects", severity: "high", label: "Redirect loop or too many redirects" },
  "internal-link-broken": { category: "links", severity: "high", label: "Internal link to an error page" },
  "robots-txt-disallowed": { category: "indexability", severity: "medium", label: "Disallowed by robots.txt" },
  "robots-meta-noindex": { category: "indexability", severity: "medium", label: "Robots meta noindex" },
  "sitemap-lists-noindex": { category: "sitemap", severity: "medium", label: "Sitemap lists a noindex page" },
  "sitemap-lists-error": { category: "sitemap", severity: "high", label: "Sitemap lists an error page" },
  "sitemap-lists-blocked": { category: "sitemap", severity: "medium", label: "Sitemap lists a page robots.txt disallows" },
  "sitemap-lists-canonicalised": { category: "sitemap", severity: "low", label: "Sitemap lists a page whose canonical is elsewhere" },
  "page-deep": { category: "structure", severity: "low", label: "Deep page" },
  "no-inbound-links-in-crawl": { category: "links", severity: "low", label: "No observed inbound internal link in this crawl" },
  "schema-missing": { category: "schema", severity: "low", label: "No JSON-LD" },
  "schema-parse-failed": { category: "schema", severity: "medium", label: "JSON-LD could not be parsed" },
  "robots-header-noindex": { category: "indexability", severity: "medium", label: "X-Robots-Tag noindex" },
  "heading-h3-without-h2": { category: "headings", severity: "low", label: "H3 on a page with no H2" },
  "image-alt-missing": { category: "images", severity: "low", label: "Images without alt attribute" },
  "link-anchor-empty": { category: "links", severity: "low", label: "Internal links with no anchor text" },
  "link-anchor-generic": { category: "links", severity: "low", label: "Internal links with generic anchor text" },
};

export const SEVERITY_RANK: Readonly<Record<FindingSeverity, number>> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Robots meta directives as written, lower-cased, split on commas and whitespace. */
export function robotsDirectives(robotsMeta: string | null): readonly string[] {
  if (robotsMeta === null) return [];
  return robotsMeta.toLowerCase().split(/[\s,]+/).filter(Boolean);
}

/** True when the page's robots meta says noindex or none. Null meta is unknown, never noindex. */
export function metaForbidsIndexing(robotsMeta: string | null): boolean {
  const directives = robotsDirectives(robotsMeta);
  return directives.includes("noindex") || directives.includes("none");
}

/** Whitespace-collapsed, trimmed; the form two titles are compared in. Empty after that is "missing". */
export function normaliseText(value: string | null): string {
  return value === null ? "" : value.replace(/\s+/g, " ").trim();
}

/** The form an anchor text is compared in: collapsed, lower-cased, without trailing punctuation. */
export function normaliseAnchorText(text: string): string {
  return normaliseText(text).toLowerCase().replace(/[\s.!:…»>›-]+$/u, "").trim();
}

/** True when an anchor's text is one of the fixed generic phrases. Empty text is not generic; it is empty. */
export function isGenericAnchorText(text: string): boolean {
  const normalised = normaliseAnchorText(text);
  return normalised !== "" && GENERIC_ANCHOR_TEXTS.includes(normalised);
}
