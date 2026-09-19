import { ISSUE_TYPE_META } from "@/lib/mock/technical/meta";
import {
  META_LENGTH,
  SEVERITY_RANK,
  TITLE_LENGTH,
} from "@/lib/mock/technical/scoring";
import type { CrawlPage, StoredPageSignals } from "@/types/crawl";
import type { IssueType, IssueTypeMeta, TechnicalSeverity } from "@/types/technical";

/**
 * Turning a crawl's stored evidence into classified findings.
 *
 * Three things are kept apart here on purpose, because collapsing them is how
 * SEO tools end up asserting more than they know:
 *
 *   * **The observation** is what the crawl stored — a title of 84 characters,
 *     no `h1`, a 404. It came off the page and is not open to argument.
 *   * **The classification** is a deterministic rule over that observation,
 *     using a threshold this project already published. No rule here weighs,
 *     scores or ranks anything; each one is a predicate that is true or false
 *     of one page.
 *   * **The advice** is not produced here at all. Severity, impact, action and
 *     owner come from `ISSUE_TYPE_META`, which states them per rule, once, for
 *     the whole product. A finding carries the page and the evidence; what to
 *     do about that kind of finding was written down long before this crawl
 *     ran.
 *
 * No overall score is produced, and none should be until the measured model is
 * complete enough to justify one. A score over thirteen rules out of
 * thirty-one would read as a verdict on a site while describing a fraction of
 * it.
 *
 * Every rule below is either a binary fact (there is no `h1`; the URL answered
 * 404) or a comparison against a constant already declared in
 * `mock/technical/scoring.ts`. Nothing is invented here, and a dimension this
 * crawl cannot see produces no rule at all — see `UNMEASURED_DIMENSIONS`.
 *
 * Pure and browser-safe, like `present.ts`: no database, no network, no clock.
 */

/** One rule matching on one page, with what the page actually said. */
export type CrawlFinding = {
  readonly type: IssueType;
  readonly url: string;
  /** Exactly what was observed, in the page's own numbers. */
  readonly evidence: string;
};

/** A rule's findings, gathered, with the metadata the product already states. */
export type FindingGroup = {
  readonly type: IssueType;
  readonly meta: IssueTypeMeta;
  readonly pages: readonly CrawlFinding[];
};

/**
 * What this crawl does not look at.
 *
 * Shown wherever the findings are, and not as a footnote. A list of issues
 * with nothing under "Performance" reads as a site with no performance
 * problems; it is in fact a crawl that never measured performance. The
 * difference matters more than any finding in the list.
 */
export const UNMEASURED_DIMENSIONS: readonly { readonly label: string; readonly why: string }[] = [
  {
    label: "Core Web Vitals and speed",
    why: "A crawl fetches HTML. It does not render the page or measure what a browser experiences.",
  },
  {
    label: "Structured data",
    why: "JSON-LD and microdata are not extracted, so nothing here can say whether schema is present, valid or complete.",
  },
  {
    label: "Indexation",
    why: "Whether Google has indexed a URL is Search Console's answer, not a crawler's.",
  },
  {
    label: "Internal links pointing at a page",
    why: "The crawl counts the links each page makes, not the links made to it, so orphan pages and thin internal support cannot be identified.",
  },
  {
    label: "Broken links",
    why: "Link targets are counted, not stored, so no link can be followed to see whether it resolves.",
  },
  {
    label: "Sitemap membership and crawl depth",
    why: "A page's presence in a sitemap and its distance from the homepage are not recorded per page.",
  },
];

/** A title or description as it is judged: trimmed, and absent means empty. */
function textOf(value: string | null): string {
  return value === null ? "" : value.trim();
}

/** Titles compare case-folded, as a browser and a SERP show them. */
function titleKey(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * The rules, over one crawl's stored rows.
 *
 * `signals` carries what each page's HTML declared; `pages` carries what each
 * URL answered. A rule reads whichever of the two recorded its evidence, and
 * the on-page rules run only over pages whose HTML was actually parsed — a PDF
 * has no `h1` to be missing, and reporting one would be a fact about the file
 * format dressed up as a fault.
 */
export function findingsFor(
  signals: readonly StoredPageSignals[],
  pages: readonly CrawlPage[],
): readonly CrawlFinding[] {
  const findings: CrawlFinding[] = [];
  const add = (type: IssueType, url: string, evidence: string) =>
    findings.push({ type, url, evidence });

  const parsed = signals.filter((page) => page.state === "parsed");

  // --- metadata, from the page's own HTML ---------------------------------
  for (const page of parsed) {
    const title = textOf(page.title);
    if (title.length === 0) {
      // There is no `missing-title` rule in the product's vocabulary, and a
      // page with no title is under thirty characters, so it is reported as
      // the rule it satisfies with the absence spelled out in the evidence.
      add("title-too-short", page.url, "No title element.");
    } else if (title.length < TITLE_LENGTH.min) {
      add("title-too-short", page.url, `Title is ${title.length} characters, under ${TITLE_LENGTH.min}.`);
    } else if (title.length > TITLE_LENGTH.max) {
      add("title-too-long", page.url, `Title is ${title.length} characters, over ${TITLE_LENGTH.max}.`);
    }

    const description = textOf(page.metaDescription);
    if (description.length === 0) {
      add("missing-meta-description", page.url, "No meta description.");
    } else if (description.length < META_LENGTH.min || description.length > META_LENGTH.max) {
      add(
        "meta-description-length",
        page.url,
        `Description is ${description.length} characters, outside ${META_LENGTH.min} to ${META_LENGTH.max}.`,
      );
    }

    if (page.h1.length === 0) add("missing-h1", page.url, "No h1 element.");
    if (page.canonicalUrl === null) add("missing-canonical", page.url, "No canonical link element.");

    // Links *out* of the page. Links *in* would need a graph this crawl does
    // not build, so `few-internal-links` — a rule about inbound links — is
    // deliberately not applied, whatever the internal-link constant says.
    if (page.internalLinks === 0) {
      add("no-outbound-internal-links", page.url, "Links to no other page on this site.");
    }
  }

  // --- duplicate titles, which are a property of the set, not of a page ----
  const byTitle = new Map<string, StoredPageSignals[]>();
  for (const page of parsed) {
    const title = textOf(page.title);
    if (title.length === 0) continue;
    const key = titleKey(title);
    byTitle.set(key, [...(byTitle.get(key) ?? []), page]);
  }
  for (const shared of byTitle.values()) {
    if (shared.length < 2) continue;
    for (const page of shared) {
      add(
        "duplicate-title",
        page.url,
        `Title "${textOf(page.title)}" is used by ${shared.length} pages in this crawl.`,
      );
    }
  }

  // --- what each URL answered ---------------------------------------------
  for (const page of pages) {
    if (page.skipReason === "robots-disallowed") {
      add("blocked-by-robots", page.url, "robots.txt disallows this URL for our crawler.");
    }

    const status = page.httpStatus;
    if (status === 404 || status === 410) {
      add("broken-page", page.url, `The URL answered ${status}.`);
    } else if (status !== null && status >= 500) {
      add("server-error", page.url, `The URL answered ${status}.`);
    }

    // One hop is ordinary. The constant for this is MAX_REDIRECT_HOPS.
    if (page.redirects.length > 1) {
      add(
        "redirect-chain",
        page.url,
        `${page.redirects.length} redirects before a final response: ${page.redirects
          .map((hop) => hop.status)
          .join(" → ")}.`,
      );
    }
    const temporary = page.redirects.filter((hop) => hop.status === 302 || hop.status === 307);
    if (temporary.length > 0) {
      add(
        "temporary-redirect",
        page.url,
        `Redirects with ${temporary.map((hop) => hop.status).join(", ")}, which browsers and crawlers treat as temporary.`,
      );
    }
  }

  return findings;
}

/**
 * Findings gathered by rule, worst first.
 *
 * Ordered by the severity the product already assigns each rule, then by how
 * many pages a rule matched. That is an ordering, not a score: no number is
 * produced for the crawl, and a rule's position says nothing about the site
 * beyond how bad this product has always considered that kind of finding.
 */
export function groupFindings(findings: readonly CrawlFinding[]): readonly FindingGroup[] {
  const byType = new Map<IssueType, CrawlFinding[]>();
  for (const finding of findings) {
    byType.set(finding.type, [...(byType.get(finding.type) ?? []), finding]);
  }

  return [...byType.entries()]
    .map(([type, pages]) => ({ type, meta: ISSUE_TYPE_META[type], pages }))
    .sort((a, b) => {
      // SEVERITY_RANK counts upward to `critical`, so worst-first is b - a.
      const bySeverity = SEVERITY_RANK[b.meta.severity] - SEVERITY_RANK[a.meta.severity];
      return bySeverity !== 0 ? bySeverity : b.pages.length - a.pages.length;
    });
}

/** How many pages each severity band touches. Counts, not a score. */
export function severityCounts(
  groups: readonly FindingGroup[],
): Readonly<Partial<Record<TechnicalSeverity, number>>> {
  const counts: Partial<Record<TechnicalSeverity, number>> = {};
  for (const group of groups) {
    counts[group.meta.severity] = (counts[group.meta.severity] ?? 0) + group.pages.length;
  }
  return counts;
}
