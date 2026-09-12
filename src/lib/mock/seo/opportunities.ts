import type { SeoOpportunity } from "@/types/seo";

/**
 * The prioritised opportunity queue surfaced by the SEO Director.
 *
 * Demo fixtures. Ordered as the Director would present them: highest priority
 * first, then best return for the effort involved.
 */
export const SEO_OPPORTUNITIES: readonly SeoOpportunity[] = [
  {
    id: "opp-01",
    title: "Build a comparison hub for the top ten competitor queries",
    type: "content",
    impact: "high",
    effort: "medium",
    priority: "critical",
    estimatedUpside: "+8.4k sessions / mo",
    project: "Halcyon Fintech",
  },
  {
    id: "opp-02",
    title: "Recover 1,840 pages excluded by a stale noindex rule",
    type: "technical",
    impact: "high",
    effort: "low",
    priority: "critical",
    estimatedUpside: "+6.1k sessions / mo",
    project: "Verdant Home",
  },
  {
    id: "opp-03",
    title: "Claim 27 unlinked brand mentions on trade publications",
    type: "authority",
    impact: "medium",
    effort: "low",
    priority: "high",
    estimatedUpside: "+27 referring domains",
    project: "Meridian Clinics",
  },
  {
    id: "opp-04",
    title: "Add structured answers to 40 pages positioned for generated answers",
    type: "ai-visibility",
    impact: "high",
    effort: "medium",
    priority: "high",
    estimatedUpside: "+14 pts AI visibility",
    project: "Orbit Logistics",
  },
  {
    id: "opp-05",
    title: "Target the transactional long tail around delivery timelines",
    type: "keyword",
    impact: "medium",
    effort: "medium",
    priority: "high",
    estimatedUpside: "+3.2k sessions / mo",
    project: "Orbit Logistics",
  },
  {
    id: "opp-06",
    title: "Rewrite titles on 126 category pages below a 2% click rate",
    type: "on-page",
    impact: "medium",
    effort: "low",
    priority: "medium",
    estimatedUpside: "+2.6k sessions / mo",
    project: "Verdant Home",
  },
  {
    id: "opp-07",
    title: "Consolidate four overlapping buying guides into one asset",
    type: "content",
    impact: "medium",
    effort: "medium",
    priority: "medium",
    estimatedUpside: "+1.9k sessions / mo",
    project: "Skyline Outdoors",
  },
  {
    id: "opp-08",
    title: "Ship a resource library to earn educational links",
    type: "authority",
    impact: "high",
    effort: "high",
    priority: "low",
    estimatedUpside: "+45 referring domains",
    project: "Skyline Outdoors",
  },
];
