import { clamp, pickSubset, randInt, volumeFor } from "@/lib/mock/dashboard/core";
import { formatCompact, formatCurrencyCompact, formatNumber } from "@/lib/format";
import type { DashboardProject } from "@/types/dashboard";
import type {
  ProjectIssue,
  ProjectIssueKind,
  ProjectIssueStatus,
  ProjectStatus,
} from "@/types/project";

/**
 * Issues and opportunities for one project.
 *
 * Hand-authored findings rather than generated sentences — an SEO defect reads
 * as a real finding or it reads as filler. Each project draws a reproducible
 * subset of the pool, sized by how much site there is and how healthy it is,
 * so a large struggling account carries a longer list than a small steady one.
 *
 * The quantified impact is the one part that is derived: a seed states the
 * gain at portfolio scale and it is scaled down to the project, so a small
 * client is never told a fix is worth eight thousand sessions a month.
 */

/** Unit the seed's `impactBase` is expressed in. */
type ImpactUnit = "sessions" | "leads" | "revenue" | "links" | "pages";

type IssueSeed = Omit<ProjectIssue, "id" | "status" | "impact"> & {
  /** Expected gain at portfolio scale, in `impactUnit`. */
  readonly impactBase: number;
  readonly impactUnit: ImpactUnit;
};

const POOL: readonly IssueSeed[] = [
  {
    kind: "critical",
    severity: "critical",
    category: "technical",
    title: "412 URLs returned 5xx during the last crawl",
    description:
      "Server errors are concentrated on paginated category URLs. Googlebot has already reduced its crawl rate on the affected directories.",
    impactBase: 6200,
    impactUnit: "sessions",
    impactLevel: "high",
    effort: "medium",
    agent: "technical-seo",
    module: "/technical",
  },
  {
    kind: "critical",
    severity: "critical",
    category: "technical",
    title: "Canonical tags point at redirected URLs",
    description:
      "A template change left canonicals resolving through a 301. Consolidation signals are being split across two versions of every affected page.",
    impactBase: 4100,
    impactUnit: "sessions",
    impactLevel: "high",
    effort: "low",
    agent: "technical-seo",
    module: "/technical",
  },
  {
    kind: "critical",
    severity: "high",
    category: "content",
    title: "Top-of-funnel cluster has lost 38% of its clicks",
    description:
      "The decline tracks an AI Overview appearing for the head term. Impressions are flat, so the pages still rank — they are no longer being clicked.",
    impactBase: 9800,
    impactUnit: "sessions",
    impactLevel: "high",
    effort: "high",
    agent: "content-strategist",
    module: "/content",
  },
  {
    kind: "critical",
    severity: "high",
    category: "keywords",
    title: "Two pages are competing for the same head term",
    description:
      "A landing page and a guide swap positions week to week. Neither holds the ranking long enough to build click history.",
    impactBase: 3400,
    impactUnit: "sessions",
    impactLevel: "medium",
    effort: "low",
    agent: "keyword-intent",
    module: "/keywords",
  },
  {
    kind: "warning",
    severity: "high",
    category: "technical",
    title: "Core Web Vitals failing on mobile templates",
    description:
      "LCP is above the threshold on the product and article templates, driven by an unoptimised hero image and a render-blocking font load.",
    impactBase: 5200,
    impactUnit: "sessions",
    impactLevel: "medium",
    effort: "medium",
    agent: "technical-seo",
    module: "/technical",
  },
  {
    kind: "warning",
    severity: "medium",
    category: "on-page",
    title: "260 pages have no meta description",
    description:
      "Search engines are writing their own snippets on these URLs. The affected set skews towards commercial pages, where the snippet does the selling.",
    impactBase: 1800,
    impactUnit: "sessions",
    impactLevel: "medium",
    effort: "low",
    agent: "on-page-seo",
    module: "/content",
  },
  {
    kind: "warning",
    severity: "medium",
    category: "technical",
    title: "Redirect chains running three hops deep",
    description:
      "Legacy migrations were layered rather than flattened. Each hop loses a little equity and adds latency on the first request.",
    impactBase: 900,
    impactUnit: "sessions",
    impactLevel: "low",
    effort: "low",
    agent: "technical-seo",
    module: "/technical",
  },
  {
    kind: "warning",
    severity: "high",
    category: "authority",
    title: "Referring domains lost after a partner site redesign",
    description:
      "A resource hub that linked to several guides was rebuilt without the outbound links. The pages are still live and still relevant.",
    impactBase: 34,
    impactUnit: "links",
    impactLevel: "medium",
    effort: "medium",
    agent: "authority-backlink",
    module: "/backlinks",
  },
  {
    kind: "warning",
    severity: "medium",
    category: "content",
    title: "Six guides have not been updated in eighteen months",
    description:
      "Each is still ranking but slipping a position a month. The statistics and screenshots in them are now visibly out of date.",
    impactBase: 3100,
    impactUnit: "sessions",
    impactLevel: "medium",
    effort: "medium",
    agent: "content-strategist",
    module: "/content",
  },
  {
    kind: "warning",
    severity: "medium",
    category: "competitors",
    title: "A rival has gained share on 240 shared terms",
    description:
      "The gain is concentrated in one cluster where they publish weekly and this site has not published since spring.",
    impactBase: 4600,
    impactUnit: "sessions",
    impactLevel: "medium",
    effort: "high",
    agent: "market-intelligence",
    module: "/competitors",
  },
  {
    kind: "opportunity",
    severity: "medium",
    category: "ai-visibility",
    title: "Answer-eligible pages are not structured for citation",
    description:
      "These pages already rank for questions that trigger AI answers, but lack the concise definitions and structured data that get them cited.",
    impactBase: 42,
    impactUnit: "pages",
    impactLevel: "high",
    effort: "medium",
    agent: "ai-visibility",
    module: "/ai-visibility",
  },
  {
    kind: "opportunity",
    severity: "high",
    category: "content",
    title: "Content gap: eighteen commercial terms have no page",
    description:
      "Competitors rank for all eighteen. The intent is commercial and the difficulty sits inside the range this site already wins in.",
    impactBase: 7400,
    impactUnit: "sessions",
    impactLevel: "high",
    effort: "high",
    agent: "content-strategist",
    module: "/content",
  },
  {
    kind: "opportunity",
    severity: "medium",
    category: "authority",
    title: "Unlinked brand mentions on high-authority domains",
    description:
      "The brand is named without a link in coverage from the last quarter. Every one of these is a single outreach email away.",
    impactBase: 9,
    impactUnit: "links",
    impactLevel: "medium",
    effort: "low",
    agent: "authority-backlink",
    module: "/backlinks",
  },
  {
    kind: "opportunity",
    severity: "medium",
    category: "keywords",
    title: "Keywords sitting in striking distance at 11-15",
    description:
      "These terms are one page of improvement away from page one, where the click curve steepens sharply.",
    impactBase: 5100,
    impactUnit: "sessions",
    impactLevel: "high",
    effort: "medium",
    agent: "keyword-intent",
    module: "/keywords",
  },
  {
    kind: "opportunity",
    severity: "low",
    category: "content",
    title: "Commercial pages have no supporting comparison content",
    description:
      "Buyers compare before they convert. There is nothing on the site to compare with, so the comparison happens on somebody else's.",
    impactBase: 2600,
    impactUnit: "revenue",
    impactLevel: "medium",
    effort: "high",
    agent: "content-strategist",
    module: "/content",
  },
  {
    kind: "quick-win",
    severity: "medium",
    category: "on-page",
    title: "Low click-through rate on page-one titles",
    description:
      "These pages rank in the top ten but earn well under the expected click share for their position. The titles are descriptive, not compelling.",
    impactBase: 2200,
    impactUnit: "sessions",
    impactLevel: "medium",
    effort: "low",
    agent: "on-page-seo",
    module: "/content",
  },
  {
    kind: "quick-win",
    severity: "low",
    category: "on-page",
    title: "Strongest pages link to nothing",
    description:
      "The pages with the most referring domains have no internal links out to the commercial pages they could be passing authority to.",
    impactBase: 1500,
    impactUnit: "sessions",
    impactLevel: "medium",
    effort: "low",
    agent: "on-page-seo",
    module: "/content",
  },
  {
    kind: "quick-win",
    severity: "low",
    category: "technical",
    title: "Sitemap still lists removed URLs",
    description:
      "The sitemap is generated from a stale export and points at pages that now 404, which wastes crawl budget on every fetch.",
    impactBase: 400,
    impactUnit: "sessions",
    impactLevel: "low",
    effort: "low",
    agent: "technical-seo",
    module: "/technical",
  },
];

/** Order issues are presented in: worst first, then openings. */
const KIND_RANK: Record<ProjectIssueKind, number> = {
  critical: 0,
  warning: 1,
  opportunity: 2,
  "quick-win": 3,
};

function formatImpact(
  project: DashboardProject,
  seed: IssueSeed,
  index: number,
): string {
  const scaled = volumeFor(project, seed.impactBase, index);

  switch (seed.impactUnit) {
    case "sessions":
      return `+${formatCompact(scaled)} sessions / mo`;
    case "leads":
      return `+${formatNumber(scaled)} leads / mo`;
    case "revenue":
      return `+${formatCurrencyCompact(scaled * 12)} / mo`;
    case "links":
      return `${formatNumber(Math.max(3, scaled))} referring domains`;
    case "pages":
      return `${formatNumber(Math.max(4, scaled))} pages affected`;
  }
}

/**
 * How many findings a project carries: a base list, longer where health is
 * poor and where there is more site for things to go wrong on.
 */
function issueCount(project: DashboardProject): number {
  const healthPenalty = Math.max(0, -project.healthOffset) / 6;
  const size = project.scale * 12;
  return Math.round(clamp(5 + healthPenalty + size, 5, POOL.length));
}

/**
 * How many *critical* findings a project may carry.
 *
 * A critical finding is a site that is actively broken — server errors,
 * canonicals pointing into redirects. A project cannot score well and be
 * broken at the same time, so the allowance is tied to health: healthy and
 * middling accounts carry warnings and opportunities, not emergencies. Without
 * this, every project draws a critical from the pool and "needs attention"
 * stops distinguishing anything.
 */
function criticalAllowance(project: DashboardProject): number {
  if (project.healthOffset > -24) return 0;
  if (project.healthOffset > -35) return 2;
  return 3;
}

function statusFor(
  project: DashboardProject,
  index: number,
  kind: ProjectIssueKind,
  projectStatus?: ProjectStatus,
): ProjectIssueStatus {
  const roll = randInt(project.seed + 401, index, 0, 9);

  // A paused engagement is watched rather than worked: nothing can be in
  // progress on a project where no work is scheduled.
  if (projectStatus === "paused") {
    return roll < 7 ? "open" : "monitoring";
  }

  if (kind === "critical") {
    return roll < 6 ? "open" : "in-progress";
  }
  if (roll < 4) return "open";
  if (roll < 7) return "in-progress";
  if (roll < 9) return "monitoring";
  return "resolved";
}

/** Issues and opportunities for one project, worst first. */
export function buildProjectIssues(
  project: DashboardProject,
  projectStatus?: ProjectStatus,
): readonly ProjectIssue[] {
  const total = issueCount(project);
  const allowance = criticalAllowance(project);

  const criticals = POOL.filter((seed) => seed.kind === "critical");
  const rest = POOL.filter((seed) => seed.kind !== "critical");

  const selected = [
    ...pickSubset(criticals, project.seed + 137, allowance),
    ...pickSubset(rest, project.seed + 137, Math.max(0, total - allowance)),
  ];

  return selected
    .map((seed, index) => ({
      ...seed,
      id: `${project.id}-issue-${index + 1}`,
      impact: formatImpact(project, seed, index),
      status: statusFor(project, index, seed.kind, projectStatus),
    }))
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}
