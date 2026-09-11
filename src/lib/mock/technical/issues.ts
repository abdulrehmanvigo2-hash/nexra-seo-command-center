import { ISSUE_TYPE_META } from "@/lib/mock/technical/meta";
import { getBasePages, getPageFacts } from "@/lib/mock/technical/pages";
import {
  CWV_THRESHOLDS,
  DEPTH_LIMIT,
  MAX_REDIRECT_HOPS,
  META_LENGTH,
  MIN_INTERNAL_LINKS_IN,
  TITLE_LENGTH,
  issuePriority,
  shareOf,
  worstSeverity,
} from "@/lib/mock/technical/scoring";
import type {
  IssueType,
  TechnicalIssue,
  TechnicalPage,
  TechnicalSeverity,
} from "@/types/technical";

/**
 * The unified issue registry.
 *
 * Every check in the module runs here, once, over the page inventory. A rule
 * lives in exactly one place: the predicate below decides whether a page fails
 * it, and `ISSUE_TYPE_META` decides what that failure is called, how serious
 * it is, who owns it, and what to do about it. No component re-derives either.
 *
 * Findings are grouped by rule within a project rather than listed per page.
 * "Forty-two pages are missing a meta description" is one job for one agent;
 * forty-two rows is a queue nobody works through. The pages behind each
 * finding are carried on the record, so the grouping costs no detail.
 *
 * Triage — acknowledging, scheduling, resolving — is session state in the UI.
 * Nothing here is dispatched, crawled, or written anywhere (CLAUDE.md §4).
 */

/** One rule: does this page fail it? */
type Check = {
  readonly type: IssueType;
  readonly failed: (page: TechnicalPage) => boolean;
};

/**
 * Every check, in the order findings are raised.
 *
 * Ordered worst-first within each area so that a page's own `severity` — the
 * worst of what is open against it — settles quickly, and so that a reader
 * scanning the list meets the outages before the tidy-ups.
 */
const CHECKS: readonly Check[] = [
  // -- HTTP ---------------------------------------------------------------
  { type: "broken-page", failed: (page) => page.crawlState === "broken" },
  { type: "server-error", failed: (page) => page.crawlState === "server-error" },
  {
    type: "redirect-chain",
    failed: (page) => page.redirectHops > MAX_REDIRECT_HOPS,
  },
  {
    type: "temporary-redirect",
    failed: (page) => page.httpStatus === 302,
  },

  // -- Crawl --------------------------------------------------------------
  {
    type: "blocked-by-robots",
    failed: (page) => page.crawlState === "blocked",
  },
  {
    type: "orphan-page",
    // A page that does not serve is not an orphan problem — it is a broken
    // page, and raising both would double-count the same URL.
    failed: (page) => page.orphan && page.crawlState === "crawlable",
  },
  {
    type: "deep-page",
    failed: (page) =>
      page.crawlDepth > DEPTH_LIMIT && page.crawlState === "crawlable",
  },

  // -- Indexation ---------------------------------------------------------
  {
    type: "indexable-not-indexed",
    failed: (page) =>
      page.indexability === "indexable" && page.indexStatus === "not-indexed",
  },
  {
    type: "indexed-noindex-conflict",
    failed: (page) =>
      page.indexability === "noindex" && page.indexStatus === "indexed",
  },
  {
    type: "excluded-page",
    failed: (page) =>
      page.indexStatus === "excluded" &&
      (page.indexability === "noindex" ||
        page.indexability === "canonicalised"),
  },

  // -- Canonical ----------------------------------------------------------
  {
    type: "canonical-conflict",
    failed: (page) => page.canonicalState === "conflict",
  },
  {
    type: "missing-canonical",
    failed: (page) =>
      page.canonicalState === "missing" && page.crawlState === "crawlable",
  },

  // -- Sitemap ------------------------------------------------------------
  {
    type: "sitemap-index-mismatch",
    failed: (page) =>
      page.inSitemap &&
      page.indexability === "indexable" &&
      page.indexStatus === "not-indexed",
  },
  {
    type: "missing-from-sitemap",
    failed: (page) => page.indexability === "indexable" && !page.inSitemap,
  },
  {
    type: "non-indexable-in-sitemap",
    failed: (page) => page.inSitemap && page.indexability !== "indexable",
  },

  // -- Metadata -----------------------------------------------------------
  {
    type: "missing-meta-description",
    failed: (page) => page.metaLength === null,
  },
  {
    type: "meta-description-length",
    failed: (page) =>
      page.metaLength !== null &&
      (page.metaLength < META_LENGTH.min || page.metaLength > META_LENGTH.max),
  },
  { type: "missing-h1", failed: (page) => !page.hasH1 },
  {
    type: "duplicate-title",
    failed: (page) => getPageFacts(page.id).duplicateTitle,
  },
  {
    type: "title-too-short",
    failed: (page) => page.titleLength < TITLE_LENGTH.min,
  },
  {
    type: "title-too-long",
    failed: (page) => page.titleLength > TITLE_LENGTH.max,
  },

  // -- Links --------------------------------------------------------------
  {
    type: "broken-internal-link",
    failed: (page) => getPageFacts(page.id).linksToBroken,
  },
  {
    type: "few-internal-links",
    // Orphans are already reported as orphans; this is the band above zero.
    failed: (page) =>
      page.internalLinksIn > 0 && page.internalLinksIn < MIN_INTERNAL_LINKS_IN,
  },
  {
    type: "no-outbound-internal-links",
    failed: (page) => page.internalLinksOut === 0,
  },

  // -- Performance --------------------------------------------------------
  {
    type: "poor-lcp",
    failed: (page) =>
      page.vitals.state !== "unmeasured" &&
      page.vitals.lcp >= CWV_THRESHOLDS.lcp.poor,
  },
  {
    type: "poor-inp",
    failed: (page) =>
      page.vitals.state !== "unmeasured" &&
      page.vitals.inp >= CWV_THRESHOLDS.inp.poor,
  },
  {
    type: "poor-cls",
    failed: (page) =>
      page.vitals.state !== "unmeasured" &&
      page.vitals.cls >= CWV_THRESHOLDS.cls.poor,
  },
  {
    type: "slow-page",
    failed: (page) => page.vitals.state === "needs-improvement",
  },

  // -- Schema -------------------------------------------------------------
  { type: "invalid-schema", failed: (page) => page.schemaState === "invalid" },
  { type: "missing-schema", failed: (page) => page.schemaState === "missing" },
  {
    type: "incomplete-schema",
    failed: (page) => page.schemaState === "partial",
  },
];

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

type Built = {
  readonly pages: readonly TechnicalPage[];
  readonly issues: readonly TechnicalIssue[];
};

let cache: Built | null = null;

function build(): Built {
  const base = getBasePages();

  // rule + project -> the pages that failed it
  const buckets = new Map<
    string,
    { projectId: string; type: IssueType; pageIds: string[] }
  >();
  const pageIssueIds = new Map<string, string[]>();
  const pageSeverity = new Map<string, TechnicalSeverity>();
  const projectPages = new Map<string, number>();

  for (const page of base) {
    projectPages.set(
      page.projectId,
      (projectPages.get(page.projectId) ?? 0) + 1,
    );
  }

  for (const page of base) {
    for (const check of CHECKS) {
      if (!check.failed(page)) continue;

      const issueId = `issue-${page.projectId}-${check.type}`;
      const bucket = buckets.get(issueId);
      if (bucket) bucket.pageIds.push(page.id);
      else {
        buckets.set(issueId, {
          projectId: page.projectId,
          type: check.type,
          pageIds: [page.id],
        });
      }

      const ids = pageIssueIds.get(page.id);
      if (ids) ids.push(issueId);
      else pageIssueIds.set(page.id, [issueId]);

      pageSeverity.set(
        page.id,
        worstSeverity(
          pageSeverity.get(page.id) ?? "healthy",
          ISSUE_TYPE_META[check.type].severity,
        ),
      );
    }
  }

  const projectNames = new Map(
    base.map((page) => [page.projectId, page.projectName]),
  );

  const issues: TechnicalIssue[] = [];

  for (const [issueId, bucket] of buckets) {
    const { projectId, type, pageIds } = bucket;
    const meta = ISSUE_TYPE_META[type];
    const total = projectPages.get(projectId) ?? 0;

    issues.push({
      id: issueId,
      projectId,
      projectName: projectNames.get(projectId) ?? projectId,
      category: meta.category,
      type,
      label: meta.label,
      severity: meta.severity,
      pageIds,
      affectedPages: pageIds.length,
      affectedShare: shareOf(pageIds.length, total),
      description: meta.description,
      impact: meta.impact,
      action: meta.action,
      owner: meta.owner,
      provenance: meta.provenance,
      priority: issuePriority(meta.severity, pageIds.length, total),
      status: "open",
    });
  }

  issues.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.affectedPages - a.affectedPages ||
      a.id.localeCompare(b.id),
  );

  const pages = base.map((page) => {
    const ids = pageIssueIds.get(page.id) ?? [];
    return {
      ...page,
      issueIds: ids,
      issueCount: ids.length,
      severity: pageSeverity.get(page.id) ?? "healthy",
    };
  });

  return { pages, issues };
}

function built(): Built {
  cache ??= build();
  return cache;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The page inventory, with every finding raised against it attached. */
export function getTechnicalPages(): readonly TechnicalPage[] {
  return built().pages;
}

export function getTechnicalPage(id: string): TechnicalPage | undefined {
  return built().pages.find((page) => page.id === id);
}

/** The page for a content record, or null where the piece is unpublished. */
export function technicalPageForContent(
  contentId: string,
): TechnicalPage | null {
  return built().pages.find((page) => page.contentId === contentId) ?? null;
}

export function pagesForProject(
  projectId: string,
): readonly TechnicalPage[] {
  return built().pages.filter((page) => page.projectId === projectId);
}

/** The registry, highest priority first. */
export function getTechnicalIssues(): readonly TechnicalIssue[] {
  return built().issues;
}

export function getTechnicalIssue(id: string): TechnicalIssue | undefined {
  return built().issues.find((issue) => issue.id === id);
}

export function issuesForProject(
  projectId: string,
): readonly TechnicalIssue[] {
  return built().issues.filter((issue) => issue.projectId === projectId);
}

/** The findings open against one page, in registry order. */
export function issuesForPage(pageId: string): readonly TechnicalIssue[] {
  return built().issues.filter((issue) => issue.pageIds.includes(pageId));
}
