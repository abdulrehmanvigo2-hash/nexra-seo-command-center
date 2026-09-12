import { round } from "@/lib/mock/dashboard/core";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import {
  CANONICAL_META,
  CATEGORY_META,
  CATEGORY_ORDER,
  CRAWL_STATE_META,
  CWV_META,
  INDEXABILITY_META,
  INDEX_STATUS_META,
  ISSUE_TYPE_META,
  SCHEMA_META,
  SCHEMA_TYPE_META,
  SEVERITY_META,
  SEVERITY_ORDER,
} from "@/lib/mock/technical/meta";
import {
  AI_AGENT_REGISTRY,
  getAgentAccess,
  getAgentDirectives,
  retrievalBlockedFor,
  retrievalPartlyBlockedFor,
} from "@/lib/mock/technical/agents";
import {
  getTechnicalIssues,
  getTechnicalPages,
  issuesForPage,
  issuesForProject,
  pagesForProject,
} from "@/lib/mock/technical/issues";
import {
  CWV_THRESHOLDS,
  DEPTH_LIMIT,
  META_LENGTH,
  MIN_INTERNAL_LINKS_IN,
  TITLE_LENGTH,
  crawlabilityScore,
  indexationScore,
  linkHealthScore,
  schemaHealthScore,
  SEVERITY_RANK,
  severityFor,
  shareOf,
  supportScore,
  technicalHealthScore,
  vitalsHealthScore,
  worstSeverity,
} from "@/lib/mock/technical/scoring";
import {
  contentRecordFor,
  expectedSchemaFor,
} from "@/lib/mock/technical/pages";
import { opportunitiesForPage } from "@/lib/mock/technical/opportunities";
import type {
  CrawlSummary,
  DetailFact,
  DistributionRow,
  IndexationSummary,
  LinkRow,
  LinkSummary,
  SchemaSummary,
  SchemaTypeRow,
  TechnicalPageDetail,
  VitalBreakdown,
  VitalsSummary,
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
  categoryLabelFor,
  getTechnicalOpportunities,
  opportunitiesForPage,
  opportunitiesForProject,
} from "@/lib/mock/technical/opportunities";

export {
  AI_AGENT_REGISTRY,
  DIRECTIVE_VALUE,
  PURPOSE_WEIGHT,
  RETRIEVAL_AGENTS,
  agentReachFor,
  directivesForProject,
  retrievalBlockersFor,
  retrievalPartlyBlockedFor,
  getAgent,
  getAgentAccess,
  getAgentDirectives,
  pathBlocked,
  retrievalBlockedFor,
} from "@/lib/mock/technical/agents";

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
  EFFORT_META,
  OPPORTUNITY_CATEGORY_FOR,
  OPPORTUNITY_CATEGORY_META,
  OPPORTUNITY_CATEGORY_ORDER,
  SCHEMA_TYPE_META,
} from "@/lib/mock/technical/meta";

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
  AGENT_ACCESS_NOTE,
  AGENT_DIRECTIVE_META,
  AGENT_DIRECTIVE_ORDER,
  AGENT_PURPOSE_META,
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
  EFFORT_ORDER,
  META_LENGTH,
  MIN_INTERNAL_LINKS_IN,
  SEVERITY_RANK,
  TITLE_LENGTH,
  severityFor,
  worstSeverity,
} from "@/lib/mock/technical/scoring";

export { expectedSchemaFor } from "@/lib/mock/technical/pages";

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
  /** How reachable the site is to generative crawlers, 0-100. */
  readonly agentAccess: number;
  /** Pages no answer-retrieval agent is allowed to fetch. */
  readonly agentBlockedPages: number;
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

  const access = getAgentAccess(projectId, pages);

  return {
    pages: pages.length,
    health: health.score,
    agentAccess: access.score,
    agentBlockedPages: access.unreachablePages,
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
  const directives = getAgentDirectives();

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

  // -- Generative crawler access ------------------------------------------
  // Each finding below is a way the directive model could contradict itself
  // or the findings raised from it.
  const projectIds = new Set<string>(pages.map((page) => page.projectId));

  for (const entry of directives) {
    if (!projectIds.has(entry.projectId)) {
      integrity.push(`Agent directive for unknown project: ${entry.projectId}`);
    }
    if (entry.directive === "partial" && entry.disallowedPaths.length === 0) {
      integrity.push(`${entry.projectId}/${entry.agent}: partial with no paths`);
    }
    if (entry.directive !== "partial" && entry.disallowedPaths.length > 0) {
      integrity.push(
        `${entry.projectId}/${entry.agent}: paths on a non-partial directive`,
      );
    }
    if (entry.directive === "allowed" && entry.blockedPages > 0) {
      integrity.push(`${entry.projectId}/${entry.agent}: allowed but blocking`);
    }
  }

  // Every agent in the registry must have a directive on every project, or a
  // project would silently read as open to an agent nobody decided about.
  const expected = AI_AGENT_REGISTRY.length * projectIds.size;
  if (directives.length !== expected) {
    integrity.push(
      `Agent directives: ${directives.length} for ${projectIds.size} projects, expected ${expected}`,
    );
  }

  // The finding and the directive are two readings of one fact, so a page
  // shut out of every retrieval agent must carry the finding, and a page that
  // is not must not.
  const flagged = new Set(
    issues
      .filter((issue) => issue.type === "ai-agent-blocked")
      .flatMap((issue) => issue.pageIds),
  );
  const shouldFlag = pages.filter(
    (page) => page.crawlState === "crawlable" && retrievalPartlyBlockedFor(page),
  );
  const missing = shouldFlag.filter((page) => !flagged.has(page.id)).length;
  if (missing > 0) {
    integrity.push(`Pages an answer engine cannot fetch without a finding: ${missing}`);
  }
  const spurious = [...flagged].filter((id) => {
    const page = pages.find((entry) => entry.id === id);
    return page !== undefined && !retrievalPartlyBlockedFor(page);
  }).length;
  if (spurious > 0) {
    integrity.push(`Agent-blocked findings on reachable pages: ${spurious}`);
  }

  // The gate is a stronger claim than the finding, so it must be a subset of
  // it: a page no engine can reach is necessarily one some engine cannot.
  const gated = pages.filter(retrievalBlockedFor);
  const inconsistent = gated.filter(
    (page) => !retrievalPartlyBlockedFor(page),
  ).length;
  if (inconsistent > 0) {
    integrity.push(`Pages gated without being flagged: ${inconsistent}`);
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
    agentDirectives: directives.length,
    byAgentDirective: tally(directives.map((entry) => entry.directive)),
    integrity,
  };
}

/** Every check the registry can raise, for the inspector. */
export const TECHNICAL_CHECK_COUNT = Object.keys(ISSUE_TYPE_META).length;


// ---------------------------------------------------------------------------
// Core Web Vitals
// ---------------------------------------------------------------------------

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Core Web Vitals across a selection.
 *
 * Pages with too little traffic to model a field reading are counted
 * separately and excluded from every rate, because a pass rate computed over
 * pages that were never measured is not a pass rate. There is one device
 * profile in this dataset, not a mobile and a desktop pair — the model has no
 * basis for two, and inventing the split would be inventing the difference.
 */
export function getVitalsSummary(
  pages: readonly TechnicalPage[],
): VitalsSummary {
  const measured = pages.filter((page) => page.vitals.state !== "unmeasured");
  const unmeasured = pages.length - measured.length;

  const passing = measured.filter((page) => page.vitals.state === "good").length;
  const poor = measured.filter((page) => page.vitals.state === "poor").length;
  const needsWork = measured.length - passing - poor;

  const band = (
    read: (page: TechnicalPage) => number,
    good: number,
    poorFloor: number,
  ) => ({
    good: measured.filter((page) => read(page) <= good).length,
    poor: measured.filter((page) => read(page) >= poorFloor).length,
  });

  const lcpBand = band(
    (page) => page.vitals.lcp,
    CWV_THRESHOLDS.lcp.good,
    CWV_THRESHOLDS.lcp.poor,
  );
  const inpBand = band(
    (page) => page.vitals.inp,
    CWV_THRESHOLDS.inp.good,
    CWV_THRESHOLDS.inp.poor,
  );
  const clsBand = band(
    (page) => page.vitals.cls,
    CWV_THRESHOLDS.cls.good,
    CWV_THRESHOLDS.cls.poor,
  );

  const vitals: readonly VitalBreakdown[] = [
    {
      id: "lcp",
      label: "Largest Contentful Paint",
      unit: "ms",
      median: Math.round(median(measured.map((page) => page.vitals.lcp))),
      good: lcpBand.good,
      needsWork: measured.length - lcpBand.good - lcpBand.poor,
      poor: lcpBand.poor,
      passRate: shareOf(lcpBand.good, Math.max(measured.length, 1)),
      goodThreshold: CWV_THRESHOLDS.lcp.good,
      poorThreshold: CWV_THRESHOLDS.lcp.poor,
      description:
        "How long the main content takes to appear. The vital visitors feel first.",
    },
    {
      id: "inp",
      label: "Interaction to Next Paint",
      unit: "ms",
      median: Math.round(median(measured.map((page) => page.vitals.inp))),
      good: inpBand.good,
      needsWork: measured.length - inpBand.good - inpBand.poor,
      poor: inpBand.poor,
      passRate: shareOf(inpBand.good, Math.max(measured.length, 1)),
      goodThreshold: CWV_THRESHOLDS.inp.good,
      poorThreshold: CWV_THRESHOLDS.inp.poor,
      description:
        "How long the page takes to respond to the first thing a visitor does.",
    },
    {
      id: "cls",
      label: "Cumulative Layout Shift",
      unit: "",
      median: round(median(measured.map((page) => page.vitals.cls)), 3),
      good: clsBand.good,
      needsWork: measured.length - clsBand.good - clsBand.poor,
      poor: clsBand.poor,
      passRate: shareOf(clsBand.good, Math.max(measured.length, 1)),
      goodThreshold: CWV_THRESHOLDS.cls.good,
      poorThreshold: CWV_THRESHOLDS.cls.poor,
      description: "How much the content moves under the reader as it loads.",
    },
  ];

  const stateRows: readonly {
    id: string;
    count: number;
    tone: DistributionRow["tone"];
  }[] = [
    { id: "good", count: passing, tone: "positive" },
    { id: "needs-improvement", count: needsWork, tone: "warning" },
    { id: "poor", count: poor, tone: "critical" },
    { id: "unmeasured", count: unmeasured, tone: "neutral" },
  ];

  return {
    total: pages.length,
    measured: measured.length,
    unmeasured,
    passing,
    needsWork,
    poor,
    passRate: shareOf(passing, Math.max(measured.length, 1)),
    score: vitalsHealthScore({
      measured: measured.length,
      passing,
      poor,
      unmeasured,
      total: pages.length,
      medianScore: Math.round(median(measured.map((page) => page.vitals.score))),
    }),
    vitals,
    states: stateRows
      .filter((row) => row.count > 0)
      .map((row) => ({
        id: row.id,
        label: CWV_META[row.id as keyof typeof CWV_META].label,
        count: row.count,
        share: shareOf(row.count, pages.length),
        tone: row.tone,
        description: CWV_META[row.id as keyof typeof CWV_META].description,
      })),
    worst: [...measured]
      .sort(
        (a, b) =>
          a.vitals.score - b.vitals.score || a.id.localeCompare(b.id),
      )
      .slice(0, 8),
  };
}

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

/**
 * Structured data across a selection.
 *
 * Types are counted against what each page's format calls for, so "missing"
 * means a type the page should have and does not — never a type it was never
 * going to carry. A clinic page is not counted as missing Product markup.
 */
export function getSchemaSummary(
  pages: readonly TechnicalPage[],
): SchemaSummary {
  const complete = pages.filter(
    (page) => page.schemaState === "complete",
  ).length;
  const partial = pages.filter((page) => page.schemaState === "partial").length;
  const invalid = pages.filter((page) => page.schemaState === "invalid").length;
  const missing = pages.filter((page) => page.schemaState === "missing").length;

  const expected = new Map<string, number>();
  const present = new Map<string, number>();
  const broken = new Map<string, number>();

  for (const page of pages) {
    for (const type of expectedSchemaFor(page.format)) {
      expected.set(type, (expected.get(type) ?? 0) + 1);
    }
    for (const type of page.schemaTypes) {
      present.set(type, (present.get(type) ?? 0) + 1);
      if (page.schemaState === "invalid") {
        broken.set(type, (broken.get(type) ?? 0) + 1);
      }
    }
  }

  const types: SchemaTypeRow[] = [...expected]
    .map(([type, want]) => {
      const have = present.get(type) ?? 0;
      return {
        type,
        present: have,
        missing: Math.max(want - have, 0),
        invalid: broken.get(type) ?? 0,
        coverage: shareOf(have, want),
        description: SCHEMA_TYPE_META[type] ?? "Structured data on the page.",
      };
    })
    .sort((a, b) => b.present - a.present || a.type.localeCompare(b.type));

  const stateRows: readonly {
    id: keyof typeof SCHEMA_META;
    count: number;
    tone: DistributionRow["tone"];
  }[] = [
    { id: "complete", count: complete, tone: "positive" },
    { id: "partial", count: partial, tone: "warning" },
    { id: "invalid", count: invalid, tone: "critical" },
    { id: "missing", count: missing, tone: "neutral" },
  ];

  return {
    total: pages.length,
    withSchema: pages.length - missing,
    missing,
    complete,
    partial,
    invalid,
    coverage: shareOf(complete, Math.max(pages.length, 1)),
    score: schemaHealthScore({
      total: pages.length,
      complete,
      partial,
      invalid,
      missing,
    }),
    states: stateRows
      .filter((row) => row.count > 0)
      .map((row) => ({
        id: row.id,
        label: SCHEMA_META[row.id].label,
        count: row.count,
        share: shareOf(row.count, pages.length),
        tone: row.tone,
        description: SCHEMA_META[row.id].description,
      })),
    types,
  };
}

// ---------------------------------------------------------------------------
// Internal links
// ---------------------------------------------------------------------------

/**
 * The internal link graph, read as findings.
 *
 * The graph is the content layer's own `linksTo` — there is no second graph
 * here. What this adds is the technical consequence of each edge: a link to a
 * URL that does not serve, one that lands on a redirect, one that lands on a
 * page excluded from the index. Those are the same link, read against what is
 * at the other end of it.
 *
 * Only pages with something wrong are listed. A well-linked page needs no row.
 */
export function getLinkSummary(
  pages: readonly TechnicalPage[],
): LinkSummary {
  const byContentId = new Map(getTechnicalPages().map((p) => [p.contentId, p]));

  let brokenLinks = 0;
  let redirectLinks = 0;
  let nonCanonicalLinks = 0;

  const rows: LinkRow[] = [];

  for (const page of pages) {
    const targets = (contentRecordFor(page.contentId)?.linksTo ?? [])
      .map((id) => byContentId.get(id))
      .filter((entry): entry is TechnicalPage => entry !== undefined);

    const brokenOut = targets.filter(
      (entry) =>
        entry.crawlState === "broken" || entry.crawlState === "server-error",
    ).length;
    const redirectOut = targets.filter(
      (entry) => entry.crawlState === "redirected",
    ).length;
    const nonCanonicalOut = targets.filter(
      (entry) =>
        entry.indexability === "canonicalised" ||
        entry.indexability === "noindex",
    ).length;

    if (brokenOut > 0) brokenLinks += 1;
    if (redirectOut > 0) redirectLinks += 1;
    if (nonCanonicalOut > 0) nonCanonicalLinks += 1;

    const deep = page.crawlDepth > DEPTH_LIMIT;
    const weak =
      page.internalLinksIn > 0 && page.internalLinksIn < MIN_INTERNAL_LINKS_IN;
    const deadEnd = page.internalLinksOut === 0;

    const findings: string[] = [];
    let severity: TechnicalPage["severity"] = "healthy";

    if (page.orphan) {
      findings.push("nothing links to it");
      severity = worstSeverity(severity, "high");
    } else if (weak) {
      findings.push(`only ${page.internalLinksIn} inbound links`);
      severity = worstSeverity(severity, "medium");
    }
    if (deep) {
      findings.push(`${page.crawlDepth} clicks deep`);
      severity = worstSeverity(severity, "medium");
    }
    if (brokenOut > 0) {
      findings.push(
        `links to ${brokenOut} URL${brokenOut === 1 ? "" : "s"} that do not serve`,
      );
      severity = worstSeverity(severity, "high");
    }
    if (redirectOut > 0) {
      findings.push(`links through ${redirectOut} redirect${redirectOut === 1 ? "" : "s"}`);
      severity = worstSeverity(severity, "low");
    }
    if (nonCanonicalOut > 0) {
      findings.push(
        `links to ${nonCanonicalOut} page${nonCanonicalOut === 1 ? "" : "s"} kept out of the index`,
      );
      severity = worstSeverity(severity, "low");
    }
    if (deadEnd) {
      findings.push("links to nothing else on the site");
      severity = worstSeverity(severity, "low");
    }

    if (findings.length === 0) continue;

    rows.push({
      pageId: page.id,
      contentId: page.contentId,
      title: page.title,
      path: page.path,
      projectId: page.projectId,
      projectName: page.projectName,
      clusterName: page.clusterName,
      linksIn: page.internalLinksIn,
      linksOut: page.internalLinksOut,
      crawlDepth: page.crawlDepth,
      orphan: page.orphan,
      brokenOut,
      redirectOut,
      nonCanonicalOut,
      severity,
      finding: `${findings[0][0].toUpperCase()}${findings[0].slice(1)}${
        findings.length > 1 ? `, and ${findings.length - 1} more` : ""
      }.`,
      support: supportScore(page.internalLinksIn, page.crawlDepth, deadEnd),
    });
  }

  const orphans = pages.filter((page) => page.orphan).length;
  const weak = pages.filter(
    (page) =>
      page.internalLinksIn > 0 && page.internalLinksIn < MIN_INTERNAL_LINKS_IN,
  ).length;
  const deadEnds = pages.filter((page) => page.internalLinksOut === 0).length;
  const meanLinksIn = round(
    mean(pages.map((page) => page.internalLinksIn)),
    1,
  );

  return {
    total: pages.length,
    orphans,
    weak,
    deep: pages.filter((page) => page.crawlDepth > DEPTH_LIMIT).length,
    brokenLinks,
    redirectLinks,
    nonCanonicalLinks,
    deadEnds,
    averageLinksIn: meanLinksIn,
    score: linkHealthScore({
      total: pages.length,
      orphans,
      weak,
      deep: pages.filter((page) => page.crawlDepth > DEPTH_LIMIT).length,
      brokenLinks,
      deadEnds,
      meanLinksIn,
    }),
    rows: rows.sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        a.support - b.support ||
        a.pageId.localeCompare(b.pageId),
    ),
  };
}

// ---------------------------------------------------------------------------
// Page detail
// ---------------------------------------------------------------------------

function fact(
  id: string,
  label: string,
  value: string,
  provenance: DetailFact["provenance"],
  detail?: string,
  tone?: DetailFact["tone"],
): DetailFact {
  return { id, label, value, detail, tone, provenance };
}

/**
 * Everything known about one URL, technically.
 *
 * Assembled from the canonical page record and the registry — neither is
 * copied, and nothing here is a second reading of either. Editorial and
 * business analysis stays in Content Studio, which this links to rather than
 * restating.
 */
export function getTechnicalPageDetail(
  pageId: string,
): TechnicalPageDetail | null {
  const all = getTechnicalPages();
  const page = all.find((entry) => entry.id === pageId);
  if (!page) return null;

  const byContentId = new Map(all.map((entry) => [entry.contentId, entry]));
  const record = contentRecordFor(page.contentId);

  const outboundPages = (record?.linksTo ?? [])
    .map((id) => byContentId.get(id))
    .filter((entry): entry is TechnicalPage => entry !== undefined);

  const inboundPages = all.filter((entry) => {
    const links = contentRecordFor(entry.contentId)?.linksTo ?? [];
    return links.includes(page.contentId);
  });

  const clusterPages = all.filter(
    (entry) => entry.clusterId === page.clusterId && entry.id !== page.id,
  );

  const response: readonly DetailFact[] = [
    fact(
      "status",
      "HTTP status",
      String(page.httpStatus),
      "seeded",
      page.redirectTarget
        ? `Redirects to ${page.redirectTarget} in ${page.redirectHops} hop${page.redirectHops === 1 ? "" : "s"}.`
        : CRAWL_STATE_META[page.crawlState].description,
      page.httpStatus >= 400
        ? "critical"
        : page.httpStatus >= 300
          ? "warning"
          : "positive",
    ),
    fact(
      "crawl",
      "Crawl state",
      CRAWL_STATE_META[page.crawlState].label,
      "derived",
      CRAWL_STATE_META[page.crawlState].description,
      page.crawlState === "crawlable" ? "positive" : "warning",
    ),
    fact(
      "robots",
      "Robots directive",
      page.robots,
      "seeded",
      page.robots.startsWith("noindex")
        ? "The page asks to be left out of the index."
        : "Open to indexing and to following its links.",
      page.robots.startsWith("noindex") ? "warning" : "positive",
    ),
    fact(
      "depth",
      "Crawl depth",
      `${page.crawlDepth} click${page.crawlDepth === 1 ? "" : "s"}`,
      "derived",
      `From the home page, against a limit of ${DEPTH_LIMIT}.`,
      page.crawlDepth > DEPTH_LIMIT ? "warning" : "positive",
    ),
  ];

  const indexing: readonly DetailFact[] = [
    fact(
      "indexability",
      "Indexability",
      INDEXABILITY_META[page.indexability].label,
      "derived",
      INDEXABILITY_META[page.indexability].description,
      page.indexability === "indexable" ? "positive" : "warning",
    ),
    fact(
      "index-status",
      "Index status",
      INDEX_STATUS_META[page.indexStatus].label,
      "seeded",
      page.indexNote,
      page.indexStatus === "indexed"
        ? "positive"
        : page.indexStatus === "not-indexed"
          ? "critical"
          : "neutral",
    ),
    fact(
      "canonical",
      "Canonical",
      CANONICAL_META[page.canonicalState].label,
      "derived",
      page.canonicalTarget ?? "No canonical tag on the page.",
      page.canonicalState === "self"
        ? "positive"
        : page.canonicalState === "conflict"
          ? "critical"
          : "neutral",
    ),
    fact(
      "sitemap",
      "Sitemap",
      page.inSitemap ? "Submitted" : "Not submitted",
      "derived",
      page.inSitemap
        ? "The URL is in the sitemap."
        : "Discovery relies on internal links alone.",
      page.inSitemap ? "positive" : "warning",
    ),
  ];

  const onPage: readonly DetailFact[] = [
    fact(
      "title",
      "Title length",
      `${page.titleLength} characters`,
      "measured",
      `Against ${TITLE_LENGTH.min}-${TITLE_LENGTH.max}.`,
      page.titleLength < TITLE_LENGTH.min || page.titleLength > TITLE_LENGTH.max
        ? "warning"
        : "positive",
    ),
    fact(
      "meta",
      "Meta description",
      page.metaLength === null ? "Missing" : `${page.metaLength} characters`,
      "measured",
      `Against ${META_LENGTH.min}-${META_LENGTH.max}.`,
      page.metaLength === null
        ? "critical"
        : page.metaLength < META_LENGTH.min || page.metaLength > META_LENGTH.max
          ? "warning"
          : "positive",
    ),
    fact(
      "h1",
      "H1",
      page.hasH1 ? "Present" : "Missing",
      "seeded",
      page.hasH1
        ? "One top-level heading carrying the page's subject."
        : "The page's subject is left to be inferred from the body.",
      page.hasH1 ? "positive" : "warning",
    ),
    fact(
      "schema",
      "Structured data",
      SCHEMA_META[page.schemaState].label,
      "derived",
      page.schemaTypes.length > 0
        ? page.schemaTypes.join(", ")
        : `Expected for this format: ${expectedSchemaFor(page.format).join(", ")}.`,
      page.schemaState === "complete"
        ? "positive"
        : page.schemaState === "invalid"
          ? "critical"
          : "warning",
    ),
  ];

  const linking: readonly DetailFact[] = [
    fact(
      "links-in",
      "Internal links in",
      String(page.internalLinksIn),
      "measured",
      page.orphan
        ? "Nothing on the site links to this page."
        : `Against a floor of ${MIN_INTERNAL_LINKS_IN}.`,
      page.orphan
        ? "critical"
        : page.internalLinksIn < MIN_INTERNAL_LINKS_IN
          ? "warning"
          : "positive",
    ),
    fact(
      "links-out",
      "Internal links out",
      String(page.internalLinksOut),
      "measured",
      page.internalLinksOut === 0
        ? "Authority stops here instead of flowing on."
        : "Links from this page to others of ours.",
      page.internalLinksOut === 0 ? "warning" : "positive",
    ),
    fact(
      "support",
      "Support score",
      String(supportScore(page.internalLinksIn, page.crawlDepth, page.internalLinksOut === 0)),
      "derived",
      "Inbound links and depth, combined.",
    ),
    fact(
      "cluster",
      "Cluster",
      page.clusterName,
      "measured",
      `${clusterPages.length} other published page${clusterPages.length === 1 ? "" : "s"} in this cluster.`,
    ),
  ];

  return {
    page,
    issues: issuesForPage(page.id),
    opportunities: opportunitiesForPage(page.id),
    response,
    indexing,
    onPage,
    linking,
    inboundPages,
    outboundPages,
    clusterPages,
  };
}

/** Every page id, for prerendering the detail routes. */
export function getTechnicalPageIds(): readonly string[] {
  return getTechnicalPages().map((page) => page.id);
}
