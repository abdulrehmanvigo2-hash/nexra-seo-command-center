import {
  CATEGORY_META,
  ISSUE_TYPE_META,
  OPPORTUNITY_CATEGORY_FOR,
} from "@/lib/mock/technical/meta";
import { getTechnicalIssues, getTechnicalPages } from "@/lib/mock/technical/issues";
import {
  opportunityImpact,
  opportunityPriority,
} from "@/lib/mock/technical/scoring";
import type { TechnicalIssue, TechnicalOpportunity } from "@/types/technical";

/**
 * The technical opportunity queue.
 *
 * Every entry reads one finding from the registry. There is no second set of
 * rules here and no second severity: what an opportunity adds is the part the
 * registry deliberately does not carry — how much work the fix is, what it is
 * worth, and therefore where it belongs in a queue.
 *
 * Ranking is `opportunityPriority` from the scoring layer, which divides value
 * by effort. A cheap fix worth a little can therefore outrank an expensive one
 * worth slightly more, which is the ordering an agency actually schedules by.
 * No threshold in this file.
 *
 * Informational findings are excluded. An intentional exclusion is a decision
 * to review, not a job to book, and a queue that listed it would be asking for
 * work nobody should do.
 */

/** Findings that describe a decision rather than a defect. */
const NOT_WORK = new Set(["excluded-page"]);

/**
 * How each finding reads as a job.
 *
 * Only where the registry's own wording would be wrong in a queue — an issue
 * says what was found, an opportunity says what to go and do. Anything absent
 * falls back to the check's own label and description.
 */
const TITLES: Partial<Record<string, string>> = {
  "broken-page": "Restore or redirect the broken pages",
  "server-error": "Get the failing URLs serving again",
  "blocked-by-robots": "Confirm the robots.txt blocks are deliberate",
  "indexed-noindex-conflict": "Settle the noindex contradictions",
  "indexable-not-indexed": "Get eligible pages into the index",
  "sitemap-index-mismatch": "Fix submitted pages the index is refusing",
  "canonical-conflict": "Resolve the canonical conflicts",
  "missing-canonical": "Add self-referencing canonicals",
  "missing-from-sitemap": "Submit the missing indexable pages",
  "non-indexable-in-sitemap": "Clean non-indexable URLs out of the sitemap",
  "orphan-page": "Link the orphan pages into the site",
  "deep-page": "Bring the buried pages closer to the surface",
  "few-internal-links": "Strengthen internal support for thin pages",
  "broken-internal-link": "Repair the broken internal links",
  "no-outbound-internal-links": "Give the dead-end pages somewhere to point",
  "missing-meta-description": "Write the missing meta descriptions",
  "meta-description-length": "Bring descriptions inside the snippet length",
  "duplicate-title": "Differentiate the duplicated titles",
  "missing-h1": "Add the missing H1s",
  "title-too-short": "Extend the thin titles",
  "title-too-long": "Tighten the truncated titles",
  "poor-lcp": "Improve Largest Contentful Paint",
  "poor-inp": "Improve Interaction to Next Paint",
  "poor-cls": "Stop the layout shifting",
  "slow-page": "Push the near-miss pages into the good band",
  "missing-schema": "Add the missing structured data",
  "invalid-schema": "Fix the structured data that fails validation",
  "incomplete-schema": "Complete the partial structured data",
  "redirect-chain": "Collapse the redirect chains",
  "temporary-redirect": "Make the permanent moves permanent",
};

let cache: readonly TechnicalOpportunity[] | null = null;

function build(): readonly TechnicalOpportunity[] {
  const pages = getTechnicalPages();

  const projectPages = new Map<string, number>();
  for (const page of pages) {
    projectPages.set(page.projectId, (projectPages.get(page.projectId) ?? 0) + 1);
  }

  const opportunities = getTechnicalIssues()
    .filter((issue) => !NOT_WORK.has(issue.type))
    .map((issue) => toOpportunity(issue, projectPages.get(issue.projectId) ?? 0));

  return opportunities.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.impactScore - a.impactScore ||
      a.id.localeCompare(b.id),
  );
}

function toOpportunity(
  issue: TechnicalIssue,
  projectPages: number,
): TechnicalOpportunity {
  const meta = ISSUE_TYPE_META[issue.type];
  const impactScore = opportunityImpact(
    issue.severity,
    issue.affectedPages,
    projectPages,
  );

  const scope =
    issue.affectedPages === 1
      ? "one page"
      : `${issue.affectedPages} pages`;

  return {
    id: `opportunity-${issue.id.slice("issue-".length)}`,
    issueId: issue.id,
    projectId: issue.projectId,
    projectName: issue.projectName,
    category: OPPORTUNITY_CATEGORY_FOR[issue.category],
    issueCategory: issue.category,
    type: issue.type,
    title: TITLES[issue.type] ?? meta.label,
    explanation: `${meta.description} Affects ${scope} on ${issue.projectName}.`,
    impact: meta.impact,
    action: meta.action,
    pageIds: issue.pageIds,
    affectedPages: issue.affectedPages,
    affectedShare: issue.affectedShare,
    severity: issue.severity,
    effort: meta.effort,
    impactScore,
    priority: opportunityPriority(impactScore, meta.effort),
    owner: meta.owner,
    provenance: meta.provenance,
  };
}

function built(): readonly TechnicalOpportunity[] {
  cache ??= build();
  return cache;
}

/** The queue, highest priority first. */
export function getTechnicalOpportunities(): readonly TechnicalOpportunity[] {
  return built();
}

export function opportunitiesForProject(
  projectId: string,
): readonly TechnicalOpportunity[] {
  return built().filter((entry) => entry.projectId === projectId);
}

/** The jobs that would touch one page. */
export function opportunitiesForPage(
  pageId: string,
): readonly TechnicalOpportunity[] {
  return built().filter((entry) => entry.pageIds.includes(pageId));
}

/** The label for an opportunity's category, for dense rows. */
export function categoryLabelFor(issue: TechnicalIssue): string {
  return CATEGORY_META[issue.category].label;
}
