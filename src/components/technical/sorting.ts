import { SEVERITY_RANK } from "@/lib/mock/technical";
import type { TechnicalIssue, TechnicalPage } from "@/types/technical";

/**
 * Ordering for the technical tables.
 *
 * Two sets of keys, one per table shape, kept beside the workspace rather than
 * inside the tables because a sort has to survive a filter change, a page
 * change, and a tab change.
 *
 * Every key sorts both directions. Ties break on id in the same direction
 * whichever way the column points, which is deliberate: equal rows should not
 * reshuffle themselves when a reader flips the arrow to look at the other end.
 */

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export type PageSort =
  | "score"
  | "severity"
  | "issues"
  | "status"
  | "depth"
  | "links"
  | "cwv"
  | "url"
  | "title";

export const PAGE_SORT_OPTIONS: readonly {
  readonly value: PageSort;
  readonly label: string;
  /** The direction most people want first. */
  readonly desc: boolean;
}[] = [
  { value: "score", label: "Technical score", desc: false },
  { value: "severity", label: "Severity", desc: true },
  { value: "issues", label: "Issue count", desc: true },
  { value: "status", label: "HTTP status", desc: true },
  { value: "depth", label: "Crawl depth", desc: true },
  { value: "links", label: "Internal links in", desc: false },
  { value: "cwv", label: "Core Web Vitals", desc: false },
  { value: "url", label: "URL", desc: false },
  { value: "title", label: "Page title", desc: false },
];

const PAGE_VALUE: Record<
  Exclude<PageSort, "url" | "title">,
  (page: TechnicalPage) => number
> = {
  score: (page) => page.score.score,
  severity: (page) => SEVERITY_RANK[page.severity],
  issues: (page) => page.issueCount,
  status: (page) => page.httpStatus,
  depth: (page) => page.crawlDepth,
  links: (page) => page.internalLinksIn,
  cwv: (page) => page.vitals.score,
};

export function comparePages(
  a: TechnicalPage,
  b: TechnicalPage,
  sort: { key: PageSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "url") {
    return a.path.localeCompare(b.path) * direction || a.id.localeCompare(b.id);
  }
  if (sort.key === "title") {
    return (
      a.title.localeCompare(b.title) * direction || a.id.localeCompare(b.id)
    );
  }

  const read = PAGE_VALUE[sort.key];
  return (read(a) - read(b)) * direction || a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export type IssueSort =
  | "priority"
  | "severity"
  | "affected"
  | "reach"
  | "category"
  | "label";

export const ISSUE_SORT_OPTIONS: readonly {
  readonly value: IssueSort;
  readonly label: string;
  readonly desc: boolean;
}[] = [
  { value: "priority", label: "Priority", desc: true },
  { value: "severity", label: "Severity", desc: true },
  { value: "affected", label: "Pages affected", desc: true },
  { value: "reach", label: "Share of project", desc: true },
  { value: "category", label: "Category", desc: false },
  { value: "label", label: "Finding", desc: false },
];

const ISSUE_VALUE: Record<
  Exclude<IssueSort, "category" | "label">,
  (issue: TechnicalIssue) => number
> = {
  priority: (issue) => issue.priority,
  severity: (issue) => SEVERITY_RANK[issue.severity],
  affected: (issue) => issue.affectedPages,
  reach: (issue) => issue.affectedShare,
};

export function compareIssues(
  a: TechnicalIssue,
  b: TechnicalIssue,
  sort: { key: IssueSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "category") {
    return (
      a.category.localeCompare(b.category) * direction ||
      a.id.localeCompare(b.id)
    );
  }
  if (sort.key === "label") {
    return (
      a.label.localeCompare(b.label) * direction || a.id.localeCompare(b.id)
    );
  }

  const read = ISSUE_VALUE[sort.key];
  return (read(a) - read(b)) * direction || a.id.localeCompare(b.id);
}
