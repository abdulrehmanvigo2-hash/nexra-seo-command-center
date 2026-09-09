import type { IconName } from "@/components/icons";
import { pickSubset, randInt } from "@/lib/mock/dashboard/core";
import type {
  ActionArea,
  DashboardProject,
  PriorityAction,
} from "@/types/dashboard";

/**
 * The priority queue the SEO Director surfaces: what to do next, why it
 * matters, and who owns it.
 *
 * Hand-authored rather than generated. An action has to name a real defect and
 * a real remedy to be worth showing, and generated text cannot do that. Each
 * project sees a reproducible slice of the pool.
 */

/** Display name and glyph for each area an action can touch. */
export const ACTION_AREA_META: Record<
  ActionArea,
  { readonly label: string; readonly icon: IconName }
> = {
  technical: { label: "Technical SEO", icon: "technical" },
  content: { label: "Content", icon: "content" },
  keywords: { label: "Keywords", icon: "keywords" },
  "on-page": { label: "On-page", icon: "content" },
  authority: { label: "Authority", icon: "backlinks" },
  "ai-visibility": { label: "AI visibility", icon: "ai-visibility" },
  competitors: { label: "Competitors", icon: "competitors" },
};

const POOL: readonly Omit<PriorityAction, "id" | "state">[] = [
  {
    priority: "critical",
    title: "Fix crawl errors blocking the product catalogue",
    area: "technical",
    affected: "1,840 URLs returning 5xx",
    impact: "+6.1k sessions / mo",
    impactLevel: "high",
    effort: "low",
    recommendation:
      "The origin is rate-limiting the crawler during peak hours. Raise the limit for verified crawler user agents and re-submit the affected sitemap segment.",
    owner: "technical-seo",
    cta: "Fix",
    module: "/technical",
  },
  {
    priority: "critical",
    title: "Resolve keyword cannibalisation across the comparison pages",
    area: "keywords",
    affected: "3 pages competing on 41 terms",
    impact: "+4.8k sessions / mo",
    impactLevel: "high",
    effort: "medium",
    recommendation:
      "Consolidate the two weaker pages into the strongest URL, redirect them, and re-point internal links so a single page holds the cluster.",
    owner: "keyword-intent",
    cta: "Review",
    module: "/keywords",
  },
  {
    priority: "high",
    title: "Refresh the declining onboarding guide",
    area: "content",
    affected: "Traffic down 34% over 90 days",
    impact: "+2.9k sessions / mo",
    impactLevel: "high",
    effort: "medium",
    recommendation:
      "Statistics are two years stale and the SERP now favours step-by-step formats. Rewrite to the refreshed brief and add the comparison table competitors rank with.",
    owner: "content-strategist",
    cta: "Open",
    module: "/content",
  },
  {
    priority: "high",
    title: "Publish the highest-opportunity article in the pricing cluster",
    area: "content",
    affected: "Brief approved, 12 days idle",
    impact: "+3.4k sessions / mo",
    impactLevel: "high",
    effort: "medium",
    recommendation:
      "Research and brief are complete and the cluster has no competing page. Release the draft to the Writer and schedule the on-page pass behind it.",
    owner: "writer",
    cta: "Open",
    module: "/content",
  },
  {
    priority: "high",
    title: "Improve click-through on high-impression, low-CTR pages",
    area: "on-page",
    affected: "126 pages below a 2% click rate",
    impact: "+2.6k sessions / mo",
    impactLevel: "medium",
    effort: "low",
    recommendation:
      "These rank in the top ten but their titles do not match the query wording. Rewrite titles and meta descriptions against the terms actually driving impressions.",
    owner: "on-page-seo",
    cta: "Fix",
    module: "/content",
  },
  {
    priority: "high",
    title: "Add missing product schema fields",
    area: "technical",
    affected: "1,204 product pages",
    impact: "Rich results eligibility",
    impactLevel: "medium",
    effort: "low",
    recommendation:
      "Price and availability were dropped from the markup in the last release, which disqualifies the pages from rich results. Restore both fields in the template.",
    owner: "technical-seo",
    cta: "Fix",
    module: "/technical",
  },
  {
    priority: "medium",
    title: "Optimise cited pages for AI answer visibility",
    area: "ai-visibility",
    affected: "40 pages already cited",
    impact: "+14 pts AI visibility",
    impactLevel: "high",
    effort: "medium",
    recommendation:
      "These pages are retrieved but rarely quoted. Add a direct answer paragraph, a definition block, and source attribution near the top of each.",
    owner: "ai-visibility",
    cta: "Review",
    module: "/ai-visibility",
  },
  {
    priority: "medium",
    title: "Reclaim lost backlinks from retired resource pages",
    area: "authority",
    affected: "27 links lost this window",
    impact: "+27 referring domains",
    impactLevel: "medium",
    effort: "low",
    recommendation:
      "The linking pages still exist but now point at removed URLs. Restore the targets or redirect them, then confirm with the publishers.",
    owner: "authority-backlink",
    cta: "Open",
    module: "/backlinks",
  },
  {
    priority: "medium",
    title: "Close the content gap a rival opened this month",
    area: "competitors",
    affected: "38 shared terms lost",
    impact: "+1.9k sessions / mo",
    impactLevel: "medium",
    effort: "medium",
    recommendation:
      "A competitor published a buying-guide hub covering terms with no matching page here. Brief the equivalent hub and prioritise the eight highest-volume terms.",
    owner: "market-intelligence",
    cta: "View",
    module: "/competitors",
  },
  {
    priority: "medium",
    title: "Cut redirect chains left by the template migration",
    area: "technical",
    affected: "205 URLs, three hops deep",
    impact: "Crawl efficiency",
    impactLevel: "low",
    effort: "low",
    recommendation:
      "Collapse each chain to a single hop so link equity is not diluted and the crawler stops spending budget on intermediate URLs.",
    owner: "technical-seo",
    cta: "Fix",
    module: "/technical",
  },
  {
    priority: "low",
    title: "Expand internal linking into the new topical cluster",
    area: "on-page",
    affected: "18 pages with fewer than 3 inbound links",
    impact: "+0.9k sessions / mo",
    impactLevel: "low",
    effort: "low",
    recommendation:
      "New cluster pages are orphaned from the main navigation paths. Add contextual links from the three highest-authority related pages.",
    owner: "on-page-seo",
    cta: "Open",
    module: "/content",
  },
];

/**
 * The queue for the selected project, highest priority first.
 *
 * `state` starts at "open" for every action; moving one to review is a
 * frontend interaction handled by the panel, not a property of the fixture.
 */
export function buildPriorityActions(
  project: DashboardProject,
): readonly PriorityAction[] {
  const count = project.portfolio ? POOL.length : randInt(project.seed, 9, 7, 9);
  const selected = pickSubset(POOL, project.seed + 5, count);

  return selected.map((action, index) => ({
    ...action,
    id: `${project.id}-action-${index + 1}`,
    state: "open" as const,
  }));
}
