import { round } from "@/lib/mock/dashboard/core";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  INDEXABILITY_META,
  ISSUE_TYPE_META,
  SEVERITY_META,
  SEVERITY_ORDER,
} from "@/lib/mock/technical/meta";
import {
  getTechnicalIssues,
  getTechnicalPages,
  issuesForProject,
  pagesForProject,
} from "@/lib/mock/technical/issues";
import {
  DEPTH_LIMIT,
  crawlabilityScore,
  indexationScore,
  severityFor,
  shareOf,
  technicalHealthScore,
} from "@/lib/mock/technical/scoring";
import type {
  CrawlSummary,
  DistributionRow,
  IndexationSummary,
  TechnicalDatasetCounts,
  TechnicalIssue,
  TechnicalMetric,
  TechnicalOverview,
  TechnicalPage,
} from "@/types/technical";

/**
 * Technical SEO: the module's public surface.
 *
 * Everything below is a reading of a selection of pages, not of the whole
 * inventory, so narrowing to one project narrows the health score, the crawl
 * summary, the coverage figures and the tiles with it — and the panel says
 * which set it is describing rather than leaving it ambiguous.
 *
 * Dependency direction is one-way: this module reads Content Studio, which
 * reads Keyword Intelligence. Nothing in those modules reads back at the data
 * layer.
 */

export {
  TECHNICAL_AS_OF,
  TECHNICAL_RANGE,
} from "@/lib/mock/technical/pages";

export {
  getTechnicalIssue,
  getTechnicalIssues,
  getTechnicalPage,
  getTechnicalPages,
  issuesForPage,
  issuesForProject,
  pagesForProject,
  technicalPageForContent,
} from "@/lib/mock/technical/issues";

export {
  CANONICAL_META,
  CANONICAL_ORDER,
  CATEGORY_META,
  CATEGORY_ORDER,
  CRAWL_STATE_META,
  CRAWL_STATE_ORDER,
  CWV_META,
  CWV_ORDER,
  INDEXABILITY_META,
  INDEXABILITY_ORDER,
  INDEX_STATUS_META,
  INDEX_STATUS_ORDER,
  ISSUE_STATUS_CYCLE,
  ISSUE_STATUS_META,
  ISSUE_STATUS_ORDER,
  ISSUE_TYPE_META,
  ISSUE_TYPE_ORDER,
  MODELLED_SOURCE_NOTE,
  PROVENANCE_META,
  SCHEMA_META,
  SCHEMA_ORDER,
  SEVERITY_META,
  SEVERITY_ORDER,
} from "@/lib/mock/technical/meta";

export {
  CWV_THRESHOLDS,
  DEPTH_LIMIT,
  META_LENGTH,
  MIN_INTERNAL_LINKS_IN,
  SEVERITY_RANK,
  TITLE_LENGTH,
  severityFor,
  worstSeverity,
} from "@/lib/mock/technical/scoring";

import { TECHNICAL_RANGE } from "@/lib/mock/technical/pages";

export const TECHNICAL_RANGE_CAPTION = TECHNICAL_RANGE.caption;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tally<T extends string>(values: readonly T[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

/** Mean of a per-page reading, as a 0-100 value. */
function meanScore(
  pages: readonly TechnicalPage[],
  read: (page: TechnicalPage) => number,
): number {
  return round(mean(pages.map(read)), 1);
}

const METADATA_VALUE = (page: TechnicalPage): number =>
  page.score.factors.find((factor) => factor.id === "metadata")?.value ?? 0;

const LINK_VALUE = (page: TechnicalPage): number =>
  page.score.factors.find((factor) => factor.id === "links")?.value ?? 0;

const SCHEMA_VALUE = (page: TechnicalPage): number =>
  page.score.factors.find((factor) => factor.id === "schema")?.value ?? 0;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Projects that have published pages, for the project filter. */
export function getTechnicalProjectOptions(): readonly {
  readonly id: string;
  readonly name: string;
}[] {
  const seen = new Map<string, string>();
  for (const page of getTechnicalPages()) {
    if (!seen.has(page.projectId)) seen.set(page.projectId, page.projectName);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** Clusters that have published pages, for the cluster filter. */
export function getTechnicalClusterOptions(): readonly {
  readonly id: string;
  readonly label: string;
  readonly projectId: string;
}[] {
  const seen = new Map<string, { label: string; projectId: string }>();
  for (const page of getTechnicalPages()) {
    if (seen.has(page.clusterId)) continue;
    seen.set(page.clusterId, {
      label: `${page.clusterName} · ${page.projectName}`,
      projectId: page.projectId,
    });
  }
  return [...seen].map(([id, entry]) => ({ id, ...entry }));
}

// ---------------------------------------------------------------------------
// Crawlability
// ---------------------------------------------------------------------------

/**
 * What a crawler can and cannot reach.
 *
 * Blocking is separated from breakage throughout. A noindex page and a 404 are
 * both absent from search, but one is a decision and the other is a defect,
 * and a summary that added them together would be reporting a problem that
 * does not exist.
 */
export function getCrawlSummary(
  pages: readonly TechnicalPage[],
): CrawlSummary {
  const total = pages.length;

  const crawlable = pages.filter(
    (page) => page.crawlState === "crawlable",
  ).length;
  const blocked = pages.filter((page) => page.crawlState === "blocked").length;
  const redirects = pages.filter(
    (page) => page.crawlState === "redirected",
  ).length;
  const broken = pages.filter(
    (page) => page.crawlState === "broken" || page.crawlState === "server-error",
  ).length;
  const noindex = pages.filter(
    (page) => page.indexability === "noindex",
  ).length;
  const orphans = pages.filter((page) => page.orphan).length;
  const deepPages = pages.filter(
    (page) => page.crawlDepth > DEPTH_LIMIT,
  ).length;
  const inSitemap = pages.filter((page) => page.inSitemap).length;
  const canonicalConflicts = pages.filter(
    (page) => page.canonicalState === "conflict",
  ).length;

  const depthBuckets: readonly { id: string; label: string; test: (depth: number) => boolean; tone: DistributionRow["tone"]; description: string }[] =
    [
      {
        id: "shallow",
        label: "1-2 clicks",
        test: (depth) => depth <= 2,
        tone: "positive",
        description: "Reachable from the home page almost immediately.",
      },
      {
        id: "mid",
        label: "3-4 clicks",
        test: (depth) => depth === 3 || depth === 4,
        tone: "accent",
        description: "Inside the crawl-depth limit.",
      },
      {
        id: "deep",
        label: "5+ clicks",
        test: (depth) => depth > DEPTH_LIMIT,
        tone: "warning",
        description: `Beyond the ${DEPTH_LIMIT}-click limit — crawled less often.`,
      },
    ];

  const depth: DistributionRow[] = depthBuckets.map((bucket) => {
    const count = pages.filter((page) => bucket.test(page.crawlDepth)).length;
    return {
      id: bucket.id,
      label: bucket.label,
      count,
      share: shareOf(count, total),
      tone: bucket.tone,
      description: bucket.description,
    };
  });

  return {
    total,
    crawlable,
    blocked,
    noindex,
    redirects,
    broken,
    orphans,
    averageDepth: round(mean(pages.map((page) => page.crawlDepth)), 1),
    deepPages,
    inSitemap,
    missingFromSitemap: pages.filter(
      (page) => page.indexability === "indexable" && !page.inSitemap,
    ).length,
    canonicalConflicts,
    // Held back on purpose: a directive we wrote, or a canonical we chose.
    intentional: blocked + noindex,
    // Actually wrong: nothing serves, or nothing links to it.
    problems: broken + orphans + canonicalConflicts,
    score: crawlabilityScore({
      total,
      crawlable,
      broken,
      orphans,
      deep: deepPages,
      inSitemap,
    }),
    depth,
  };
}

// ---------------------------------------------------------------------------
// Indexation
// ---------------------------------------------------------------------------

/**
 * What is in the index, and what is allowed to be.
 *
 * The two readings are kept apart. `indexable` counts permission; `indexed`
 * counts presence; and the only figure worth acting on is the difference
 * between them.
 */
export function getIndexationSummary(
  pages: readonly TechnicalPage[],
): IndexationSummary {
  const total = pages.length;

  const indexed = pages.filter((page) => page.indexStatus === "indexed").length;
  const notIndexed = pages.filter(
    (page) => page.indexStatus === "not-indexed",
  ).length;
  const excluded = pages.filter(
    (page) => page.indexStatus === "excluded",
  ).length;
  const pending = pages.filter((page) => page.indexStatus === "pending").length;

  const indexable = pages.filter(
    (page) => page.indexability === "indexable",
  ).length;
  const noindex = pages.filter(
    (page) => page.indexability === "noindex",
  ).length;
  const canonicalised = pages.filter(
    (page) => page.indexability === "canonicalised",
  ).length;
  const blocked = pages.filter(
    (page) => page.indexability === "blocked",
  ).length;
  const redirects = pages.filter(
    (page) => page.indexability === "redirect",
  ).length;
  const errors = pages.filter((page) => page.indexability === "error").length;

  const sitemapMismatches = pages.filter(
    (page) =>
      page.inSitemap &&
      page.indexability === "indexable" &&
      page.indexStatus === "not-indexed",
  ).length;
  const conflicts = pages.filter(
    (page) => page.indexability === "noindex" && page.indexStatus === "indexed",
  ).length;

  const reasonRows: readonly { id: string; label: string; count: number; tone: DistributionRow["tone"]; description: string }[] =
    [
      {
        id: "noindex",
        label: INDEXABILITY_META.noindex.label,
        count: noindex,
        tone: "neutral",
        description: INDEXABILITY_META.noindex.description,
      },
      {
        id: "canonicalised",
        label: INDEXABILITY_META.canonicalised.label,
        count: canonicalised,
        tone: "neutral",
        description: INDEXABILITY_META.canonicalised.description,
      },
      {
        id: "redirect",
        label: INDEXABILITY_META.redirect.label,
        count: redirects,
        tone: "accent",
        description: INDEXABILITY_META.redirect.description,
      },
      {
        id: "blocked",
        label: INDEXABILITY_META.blocked.label,
        count: blocked,
        tone: "warning",
        description: INDEXABILITY_META.blocked.description,
      },
      {
        id: "error",
        label: INDEXABILITY_META.error.label,
        count: errors,
        tone: "critical",
        description: INDEXABILITY_META.error.description,
      },
    ];

  return {
    total,
    indexed,
    notIndexed,
    excluded,
    pending,
    indexable,
    noindex,
    canonicalised,
    blocked,
    redirects,
    errors,
    sitemapMismatches,
    conflicts,
    coverage: shareOf(indexed, Math.max(indexable, 1)),
    score: indexationScore({
      total,
      indexable,
      indexed,
      mismatches: sitemapMismatches,
      conflicts,
    }),
    reasons: reasonRows
      .filter((row) => row.count > 0)
      .map((row) => ({ ...row, share: shareOf(row.count, total) })),
  };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * The headline reading for a selection.
 *
 * One call, because every figure on the overview has to describe the same set
 * of pages. Assembling them separately in the component is how a card ends up
 * counting a page the table below it has already filtered out.
 */
export function getTechnicalOverview(
  pages: readonly TechnicalPage[],
  issues: readonly TechnicalIssue[],
): TechnicalOverview {
  const crawl = getCrawlSummary(pages);
  const indexation = getIndexationSummary(pages);

  const criticalIssues = issues.filter(
    (issue) => issue.severity === "critical",
  ).length;

  const vitalsScored = pages.filter(
    (page) => page.vitals.state !== "unmeasured",
  );
  const cwvPassing = pages.filter(
    (page) => page.vitals.state === "good",
  ).length;
  const schemaCovered = pages.filter(
    (page) => page.schemaState === "complete" || page.schemaState === "partial",
  ).length;
  const brokenLinks = issues
    .filter((issue) => issue.type === "broken-internal-link")
    .reduce((carry, issue) => carry + issue.affectedPages, 0);

  const health = technicalHealthScore({
    crawl: crawl.score.score,
    indexation: indexation.score.score,
    vitals: meanScore(pages, (page) => page.vitals.score),
    schema: meanScore(pages, SCHEMA_VALUE),
    metadata: meanScore(pages, METADATA_VALUE),
    links: meanScore(pages, LINK_VALUE),
    criticalIssues,
    pages: pages.length,
  });

  const metrics: readonly TechnicalMetric[] = [
    {
      id: "health",
      label: "Technical health",
      value: String(health.score),
      unit: "/ 100",
      detail: SEVERITY_META[health.severity].description,
      icon: "gauge",
      health:
        health.severity === "healthy"
          ? "positive"
          : health.severity === "low"
            ? "neutral"
            : health.severity === "medium"
              ? "warning"
              : "negative",
    },
    {
      id: "critical",
      label: "Critical issues",
      value: formatNumber(criticalIssues),
      detail:
        criticalIssues === 0
          ? "Nothing is currently stopping a page from being served."
          : `Across ${formatNumber(
              issues
                .filter((issue) => issue.severity === "critical")
                .reduce((carry, issue) => carry + issue.affectedPages, 0),
            )} URLs.`,
      icon: "alert",
      health: criticalIssues === 0 ? "positive" : "negative",
    },
    {
      id: "crawlable",
      label: "Crawlable pages",
      value: formatNumber(crawl.crawlable),
      unit: `of ${formatCompact(crawl.total)}`,
      detail: `${formatPercent(shareOf(crawl.crawlable, crawl.total), 0)} of published URLs return content.`,
      icon: "refresh",
      health: crawl.crawlable === crawl.total ? "positive" : "warning",
    },
    {
      id: "indexed",
      label: "Indexed pages",
      value: formatNumber(indexation.indexed),
      unit: `of ${formatCompact(indexation.indexable)}`,
      detail: `${formatPercent(indexation.coverage, 0)} of indexable URLs are in the index.`,
      icon: "inbox",
      health:
        indexation.coverage >= 90
          ? "positive"
          : indexation.coverage >= 75
            ? "warning"
            : "negative",
    },
    {
      id: "cwv",
      label: "CWV passing",
      value: formatNumber(cwvPassing),
      unit: `of ${formatCompact(vitalsScored.length)}`,
      detail:
        vitalsScored.length === 0
          ? "No page has enough traffic to model a field reading."
          : `${formatPercent(shareOf(cwvPassing, vitalsScored.length), 0)} of measured URLs pass all three vitals.`,
      icon: "activity",
      health:
        shareOf(cwvPassing, Math.max(vitalsScored.length, 1)) >= 75
          ? "positive"
          : "warning",
    },
    {
      id: "schema",
      label: "Schema coverage",
      value: formatPercent(shareOf(schemaCovered, pages.length), 0),
      detail: `${formatNumber(schemaCovered)} URLs carry at least some structured data.`,
      icon: "layers",
      health:
        shareOf(schemaCovered, Math.max(pages.length, 1)) >= 70
          ? "positive"
          : "warning",
    },
    {
      id: "broken-links",
      label: "Broken links",
      value: formatNumber(brokenLinks),
      detail:
        brokenLinks === 0
          ? "No page links to a URL that fails to serve."
          : "Pages linking to a URL that does not resolve.",
      icon: "link-off",
      health: brokenLinks === 0 ? "positive" : "warning",
    },
    {
      id: "orphans",
      label: "Orphan pages",
      value: formatNumber(crawl.orphans),
      detail:
        crawl.orphans === 0
          ? "Every page is linked from somewhere on the site."
          : "No internal link points at these URLs.",
      icon: "link-off",
      health: crawl.orphans === 0 ? "positive" : "warning",
    },
  ];

  const severityCounts = tally(pages.map((page) => page.severity));
  const severity: DistributionRow[] = SEVERITY_ORDER.map((band) => ({
    id: band,
    label: SEVERITY_META[band].label,
    count: severityCounts[band] ?? 0,
    share: shareOf(severityCounts[band] ?? 0, pages.length),
    tone: SEVERITY_META[band].tone,
    description: SEVERITY_META[band].description,
  })).filter((row) => row.count > 0);

  const categoryCounts: Record<string, number> = {};
  for (const issue of issues) {
    categoryCounts[issue.category] =
      (categoryCounts[issue.category] ?? 0) + issue.affectedPages;
  }
  const categories: DistributionRow[] = CATEGORY_ORDER.map((category) => ({
    id: category,
    label: CATEGORY_META[category].label,
    count: categoryCounts[category] ?? 0,
    share: shareOf(
      categoryCounts[category] ?? 0,
      Object.values(categoryCounts).reduce((a, b) => a + b, 0),
    ),
    tone:
      category === "http" || category === "indexation"
        ? ("critical" as const)
        : category === "crawl" || category === "canonical"
          ? ("warning" as const)
          : ("accent" as const),
    description: CATEGORY_META[category].description,
  })).filter((row) => row.count > 0);

  return {
    health,
    crawl,
    indexation,
    metrics,
    severity,
    categories,
    topIssues: issues.slice(0, 6),
    worstPages: [...pages]
      .sort(
        (a, b) =>
          a.score.score - b.score.score ||
          b.issueCount - a.issueCount ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 8),
  };
}

// ---------------------------------------------------------------------------
// Integration readers
// ---------------------------------------------------------------------------

/**
 * The counts the Command Center and a project page show.
 *
 * Read from the same registry the workspace reads, so a figure quoted on the
 * dashboard and the same figure inside the module are one reading rather than
 * two. `"portfolio"` means every project.
 */
export type TechnicalSnapshotCounts = {
  readonly pages: number;
  readonly health: number;
  readonly severity: TechnicalPage["severity"];
  readonly criticalIssues: number;
  readonly openIssues: number;
  readonly affectedPages: number;
  readonly crawlable: number;
  readonly indexed: number;
  readonly indexable: number;
  readonly coverage: number;
  readonly orphans: number;
  readonly cwvPassing: number;
  /** The single finding to act on first, or null where there are none. */
  readonly topIssue: TechnicalIssue | null;
};

export function getTechnicalSnapshotCounts(
  projectId: string,
): TechnicalSnapshotCounts {
  const pages =
    projectId === "portfolio" ? getTechnicalPages() : pagesForProject(projectId);
  const issues =
    projectId === "portfolio"
      ? getTechnicalIssues()
      : issuesForProject(projectId);

  const crawl = getCrawlSummary(pages);
  const indexation = getIndexationSummary(pages);

  const criticalIssues = issues.filter(
    (issue) => issue.severity === "critical",
  ).length;

  const health = technicalHealthScore({
    crawl: crawl.score.score,
    indexation: indexation.score.score,
    vitals: meanScore(pages, (page) => page.vitals.score),
    schema: meanScore(pages, SCHEMA_VALUE),
    metadata: meanScore(pages, METADATA_VALUE),
    links: meanScore(pages, LINK_VALUE),
    criticalIssues,
    pages: pages.length,
  });

  return {
    pages: pages.length,
    health: health.score,
    severity: health.severity,
    criticalIssues,
    openIssues: issues.length,
    affectedPages: pages.filter((page) => page.issueCount > 0).length,
    crawlable: crawl.crawlable,
    indexed: indexation.indexed,
    indexable: indexation.indexable,
    coverage: indexation.coverage,
    orphans: crawl.orphans,
    cwvPassing: pages.filter((page) => page.vitals.state === "good").length,
    topIssue: issues[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Development inspector
// ---------------------------------------------------------------------------

/**
 * Counts and an integrity pass, for `/dev/data`.
 *
 * The integrity list is the check that matters: every finding it can return is
 * a way the derived dataset could contradict the canonical one it was built
 * from. An empty list is the passing result.
 */
export function getTechnicalDatasetCounts(): TechnicalDatasetCounts {
  const pages = getTechnicalPages();
  const issues = getTechnicalIssues();

  const pageIds = new Set(pages.map((page) => page.id));
  const issueIds = new Set(issues.map((issue) => issue.id));
  const integrity: string[] = [];

  if (pageIds.size !== pages.length) {
    integrity.push(`Duplicate page ids: ${pages.length - pageIds.size}`);
  }
  if (issueIds.size !== issues.length) {
    integrity.push(`Duplicate issue ids: ${issues.length - issueIds.size}`);
  }

  // A URL is only a duplicate within its own site. Two clients can both
  // publish a /pricing page, and calling that a collision would be a finding
  // against nothing.
  const urls = new Set(pages.map((page) => `${page.projectId}::${page.url}`));
  if (urls.size !== pages.length) {
    integrity.push(`Duplicate URLs within a project: ${pages.length - urls.size}`);
  }

  const deadPageRefs = issues.reduce(
    (carry, issue) =>
      carry + issue.pageIds.filter((id) => !pageIds.has(id)).length,
    0,
  );
  if (deadPageRefs > 0) {
    integrity.push(`Issues referencing unknown pages: ${deadPageRefs}`);
  }

  const deadIssueRefs = pages.reduce(
    (carry, page) =>
      carry + page.issueIds.filter((id) => !issueIds.has(id)).length,
    0,
  );
  if (deadIssueRefs > 0) {
    integrity.push(`Pages referencing unknown issues: ${deadIssueRefs}`);
  }

  const projectLeaks = issues.filter((issue) =>
    issue.pageIds.some(
      (id) => pages.find((page) => page.id === id)?.projectId !== issue.projectId,
    ),
  ).length;
  if (projectLeaks > 0) {
    integrity.push(`Issues spanning more than one project: ${projectLeaks}`);
  }

  const emptyIssues = issues.filter((issue) => issue.affectedPages === 0).length;
  if (emptyIssues > 0) {
    integrity.push(`Issues affecting no pages: ${emptyIssues}`);
  }

  // A page carrying findings cannot be healthy, and a page with none cannot be
  // anything else. Either would mean the registry and the page disagree.
  const severityMismatch = pages.filter(
    (page) =>
      (page.issueCount === 0) !== (page.severity === "healthy"),
  ).length;
  if (severityMismatch > 0) {
    integrity.push(`Pages whose severity disagrees with their findings: ${severityMismatch}`);
  }

  const scoreOutOfBand = pages.filter(
    (page) => severityFor(page.score.score) !== page.score.severity,
  ).length;
  if (scoreOutOfBand > 0) {
    integrity.push(`Page scores outside their own band: ${scoreOutOfBand}`);
  }

  return {
    pages: pages.length,
    issues: issues.length,
    projects: new Set(pages.map((page) => page.projectId)).size,
    clusters: new Set(pages.map((page) => page.clusterId)).size,
    bySeverity: tally(pages.map((page) => page.severity)),
    byCategory: tally(issues.map((issue) => issue.category)),
    byCrawlState: tally(pages.map((page) => page.crawlState)),
    byIndexStatus: tally(pages.map((page) => page.indexStatus)),
    byIndexability: tally(pages.map((page) => page.indexability)),
    byCanonical: tally(pages.map((page) => page.canonicalState)),
    byCwv: tally(pages.map((page) => page.vitals.state)),
    bySchema: tally(pages.map((page) => page.schemaState)),
    byIssueType: tally(issues.map((issue) => issue.type)),
    integrity,
  };
}

/** Every check the registry can raise, for the inspector. */
export const TECHNICAL_CHECK_COUNT = Object.keys(ISSUE_TYPE_META).length;
