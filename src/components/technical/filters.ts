import { SEVERITY_RANK } from "@/lib/mock/technical";
import type {
  CanonicalState,
  CrawlState,
  CwvState,
  IndexStatus,
  Indexability,
  IssueCategory,
  SchemaState,
  TechnicalIssue,
  TechnicalPage,
  TechnicalSeverity,
} from "@/types/technical";

/**
 * Filtering for Technical SEO.
 *
 * One filter object over two record shapes. A page and a finding are different
 * things, but somebody narrowing to one project or one severity expects both
 * to narrow together — so the predicates share a state object, and the
 * workspace applies them in a fixed order: pages first, then the findings that
 * still have a page behind them.
 *
 * That order is what keeps the tab counts and the tables they label describing
 * the same set. Filtering findings independently would leave a finding on
 * screen whose pages had all been filtered away.
 */

export type TechnicalFilters = {
  /** Matched against the URL, title, project, cluster, and finding text. */
  readonly query: string;
  /** Project id, or "all". */
  readonly project: string;
  /** Cluster id, or "all". */
  readonly cluster: string;
  readonly severity: TechnicalSeverity | "all";
  readonly category: IssueCategory | "all";
  readonly crawlState: CrawlState | "all";
  readonly indexStatus: IndexStatus | "all";
  readonly indexability: Indexability | "all";
  readonly canonical: CanonicalState | "all";
  readonly cwv: CwvState | "all";
  readonly schema: SchemaState | "all";
};

export const EMPTY_TECHNICAL_FILTERS: TechnicalFilters = {
  query: "",
  project: "all",
  cluster: "all",
  severity: "all",
  category: "all",
  crawlState: "all",
  indexStatus: "all",
  indexability: "all",
  canonical: "all",
  cwv: "all",
  schema: "all",
};

/** Filters that narrow a page, not counting the project scope or the search. */
const PAGE_FILTER_KEYS: readonly (keyof TechnicalFilters)[] = [
  "severity",
  "crawlState",
  "indexStatus",
  "indexability",
  "canonical",
  "cwv",
  "schema",
];

export function activeTechnicalFilterCount(
  filters: TechnicalFilters,
): number {
  let count = 0;
  if (filters.project !== "all") count += 1;
  if (filters.cluster !== "all") count += 1;
  if (filters.category !== "all") count += 1;
  for (const key of PAGE_FILTER_KEYS) {
    if (filters[key] !== "all") count += 1;
  }
  return count;
}

export function hasActiveTechnicalFilters(
  filters: TechnicalFilters,
): boolean {
  return (
    filters.query.trim().length > 0 || activeTechnicalFilterCount(filters) > 0
  );
}

/** Whether a page's own text matches the search. */
export function pageMatchesQuery(
  page: TechnicalPage,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return `${page.title} ${page.path} ${page.url} ${page.projectName} ${page.clusterName} ${page.format}`
    .toLowerCase()
    .includes(needle);
}

/** Whether a finding's own text matches the search. */
export function issueMatchesQuery(
  issue: TechnicalIssue,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return `${issue.label} ${issue.category} ${issue.type} ${issue.projectName} ${issue.description} ${issue.action}`
    .toLowerCase()
    .includes(needle);
}

/**
 * Whether a page survives the filters.
 *
 * The category filter is deliberately applied to pages too, resolved through
 * the findings open against them: narrowing to "Metadata" and then seeing
 * pages with no metadata problem in the table below would be a filter that
 * does not filter.
 */
export function matchesPage(
  page: TechnicalPage,
  filters: TechnicalFilters,
  /** Pages carrying at least one finding in the selected category. */
  categoryPageIds?: ReadonlySet<string>,
): boolean {
  if (!pageMatchesQuery(page, filters.query)) return false;
  if (filters.project !== "all" && page.projectId !== filters.project) {
    return false;
  }
  if (filters.cluster !== "all" && page.clusterId !== filters.cluster) {
    return false;
  }
  if (filters.severity !== "all" && page.severity !== filters.severity) {
    return false;
  }
  if (filters.crawlState !== "all" && page.crawlState !== filters.crawlState) {
    return false;
  }
  if (
    filters.indexStatus !== "all" &&
    page.indexStatus !== filters.indexStatus
  ) {
    return false;
  }
  if (
    filters.indexability !== "all" &&
    page.indexability !== filters.indexability
  ) {
    return false;
  }
  if (filters.canonical !== "all" && page.canonicalState !== filters.canonical) {
    return false;
  }
  if (filters.cwv !== "all" && page.vitals.state !== filters.cwv) return false;
  if (filters.schema !== "all" && page.schemaState !== filters.schema) {
    return false;
  }
  if (
    filters.category !== "all" &&
    categoryPageIds !== undefined &&
    !categoryPageIds.has(page.id)
  ) {
    return false;
  }
  return true;
}

/**
 * Whether a finding survives the filters.
 *
 * `pageIds` is the set of pages that survived, and a finding needs at least
 * one of them: a "missing meta description" finding against forty-two pages
 * is not a finding about this project once the other project is filtered out.
 */
export function matchesIssue(
  issue: TechnicalIssue,
  filters: TechnicalFilters,
  pageIds: ReadonlySet<string>,
): boolean {
  if (filters.project !== "all" && issue.projectId !== filters.project) {
    return false;
  }
  if (filters.category !== "all" && issue.category !== filters.category) {
    return false;
  }
  if (filters.severity !== "all" && issue.severity !== filters.severity) {
    return false;
  }
  if (!issue.pageIds.some((id) => pageIds.has(id))) return false;

  // The search reaches a finding through its own text or through the pages it
  // is raised against, so typing a URL finds what is wrong with it.
  if (
    !issueMatchesQuery(issue, filters.query) &&
    !issue.pageIds.some((id) => pageIds.has(id))
  ) {
    return false;
  }
  return true;
}

/** The findings still standing, narrowed to the pages that survived. */
export function scopeIssueToPages(
  issue: TechnicalIssue,
  pageIds: ReadonlySet<string>,
): TechnicalIssue {
  const kept = issue.pageIds.filter((id) => pageIds.has(id));
  if (kept.length === issue.pageIds.length) return issue;
  return { ...issue, pageIds: kept, affectedPages: kept.length };
}

export { SEVERITY_RANK };
