import { minutesBefore, pickSubset, randInt } from "@/lib/mock/dashboard/core";
import type {
  ActivityCategory,
  ActivityEvent,
  DashboardAlert,
  DashboardProject,
} from "@/types/dashboard";

/**
 * The two live signal streams on the Command Center: risks that need a
 * decision, and the audit trail of what the platform has been doing.
 *
 * Both are hand-authored pools that each project draws a reproducible slice
 * from. Timestamps are expressed as an age in minutes and resolved against the
 * fixed reference instant, so the relative labels ("2h ago") stay stable
 * between the server render and the browser.
 */

type AlertSeed = Omit<DashboardAlert, "id" | "detectedAt" | "project"> & {
  /** Minutes before the reference instant that this was detected. */
  readonly age: number;
};

const ALERT_POOL: readonly AlertSeed[] = [
  {
    severity: "critical",
    title: "Organic traffic dropped sharply on the product templates",
    detail:
      "Sessions to /shop fell away over 48 hours while impressions held steady, which points at a click-through or rendering problem rather than a ranking loss.",
    metric: "Organic sessions, /shop",
    change: { value: -28.4 },
    module: "/analytics",
    age: 95,
  },
  {
    severity: "critical",
    title: "Indexing dropped on 1,840 URLs",
    detail:
      "A noindex directive survived the template migration and is now served on the whole catalogue segment. Coverage reports confirm removal has started.",
    metric: "Indexed URLs",
    change: { value: -12.1 },
    module: "/technical",
    age: 210,
  },
  {
    severity: "high",
    title: "Ranking loss across the comparison cluster",
    detail:
      "Eleven terms fell out of the top ten in a single update. The affected pages share a template that lost its FAQ markup last week.",
    metric: "Top 10 keywords",
    change: { value: -9.6 },
    module: "/keywords",
    age: 380,
  },
  {
    severity: "high",
    title: "Crawl rate spiked well above the baseline",
    detail:
      "Crawl requests tripled overnight, concentrated on faceted filter URLs. Budget is being spent on parameters that should not be crawlable.",
    metric: "Daily crawl requests",
    change: { value: 214.0 },
    module: "/technical",
    age: 640,
  },
  {
    severity: "high",
    title: "A competitor is taking share on shared terms",
    detail:
      "Their visibility rose across 38 terms this window, all of them covered by a hub page published three weeks ago.",
    metric: "Share of voice",
    change: { value: -4.2 },
    module: "/competitors",
    age: 1_180,
  },
  {
    severity: "medium",
    title: "Backlinks lost from three referring domains",
    detail:
      "The linking pages were retired during a site restructure. The targets still resolve, so these are recoverable through outreach.",
    metric: "Referring domains",
    change: { value: -1.8 },
    module: "/backlinks",
    age: 1_620,
  },
  {
    severity: "medium",
    title: "Content decay detected on six long-form guides",
    detail:
      "Each has lost more than a quarter of its clicks over ninety days while holding position, which usually means the SERP intent has shifted.",
    metric: "Clicks, guides",
    change: { value: -26.5 },
    module: "/content",
    age: 2_450,
  },
  {
    severity: "low",
    title: "Core Web Vitals slipped on the blog template",
    detail:
      "Cumulative layout shift crossed the threshold on mobile after a new embed was added to the article header.",
    metric: "CLS, mobile",
    change: { value: 18.3 },
    module: "/technical",
    age: 3_100,
  },
];

/** Risks and regressions for the selected project, most severe first. */
export function buildAlerts(project: DashboardProject): readonly DashboardAlert[] {
  const count = project.portfolio ? ALERT_POOL.length : randInt(project.seed, 6, 4, 6);
  const selected = pickSubset(ALERT_POOL, project.seed + 11, count);

  return selected.map((alert, index) => ({
    id: `${project.id}-alert-${index + 1}`,
    severity: alert.severity,
    title: alert.title,
    detail: alert.detail,
    metric: alert.metric,
    change: alert.change,
    detectedAt: minutesBefore(alert.age),
    module: alert.module,
    project: project.name,
  }));
}

type ActivitySeed = Omit<ActivityEvent, "id" | "at" | "project"> & {
  readonly age: number;
};

const ACTIVITY_POOL: readonly ActivitySeed[] = [
  {
    category: "agent",
    title: "Keyword cluster completed",
    detail: "412 discovered terms grouped into 18 clusters and classified by intent.",
    agent: "keyword-intent",
    state: "success",
    age: 18,
  },
  {
    category: "technical",
    title: "Technical issue detected",
    detail: "Duplicate canonical tags found across 612 paginated archive URLs.",
    agent: "technical-seo",
    state: "warning",
    age: 42,
  },
  {
    category: "content",
    title: "Article optimised",
    detail: "On-page pass applied to the business-banking comparison hub.",
    agent: "on-page-seo",
    state: "success",
    age: 76,
  },
  {
    category: "ranking",
    title: "Ranking improved",
    detail: "Pricing hub moved from position 9 to position 3 on its head term.",
    agent: "analytics-learning",
    state: "success",
    age: 128,
  },
  {
    category: "content",
    title: "Content brief generated",
    detail: "Brief drafted for the freight-audit timeline cluster with 14 sourced citations.",
    agent: "content-strategist",
    state: "info",
    age: 165,
  },
  {
    category: "authority",
    title: "Backlink acquired",
    detail: "Followed link earned from a trade publication with an authority score of 81.",
    agent: "authority-backlink",
    state: "success",
    age: 240,
  },
  {
    category: "competitor",
    title: "Competitor gained visibility",
    detail: "Northpeak added 38 shared terms to the top ten after publishing a hub page.",
    agent: "market-intelligence",
    state: "warning",
    age: 315,
  },
  {
    category: "ai-visibility",
    title: "Citation earned in AI answers",
    detail: "Cited by two answer engines across eleven comparison prompts.",
    agent: "ai-visibility",
    state: "success",
    age: 420,
  },
  {
    category: "technical",
    title: "Fix deployed",
    detail: "Redirect chains collapsed to a single hop on 205 legacy category URLs.",
    agent: "technical-seo",
    state: "success",
    age: 505,
  },
  {
    category: "agent",
    title: "Run blocked",
    detail: "Attribution run stopped: the analytics export returned an incomplete date range.",
    agent: "analytics-learning",
    state: "critical",
    age: 610,
  },
  {
    category: "content",
    title: "Draft submitted for review",
    detail: "Eight product-comparison drafts completed and queued for editorial review.",
    agent: "writer",
    state: "info",
    age: 745,
  },
  {
    category: "ranking",
    title: "New rankings recorded",
    detail: "94 terms entered the top 100 for the first time this window.",
    agent: "analytics-learning",
    state: "success",
    age: 880,
  },
  {
    category: "agent",
    title: "Evidence pack verified",
    detail: "38 regulatory claims checked against primary sources and approved.",
    agent: "research-evidence",
    state: "success",
    age: 1_020,
  },
  {
    category: "authority",
    title: "Outreach campaign opened",
    detail: "60 digital-PR prospects qualified for the annual industry report.",
    agent: "authority-backlink",
    state: "info",
    age: 1_240,
  },
  {
    category: "technical",
    title: "Crawl completed",
    detail: "Full crawl finished with 48,240 URLs discovered and 14 defects raised.",
    agent: "technical-seo",
    state: "info",
    age: 1_480,
  },
  {
    category: "agent",
    title: "Roadmap re-prioritised",
    detail: "SEO Director resequenced the next cycle from the latest analytics feedback.",
    agent: "seo-director",
    state: "info",
    age: 1_700,
  },
];

/** Filter order for the activity feed control. */
export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  "agent",
  "technical",
  "content",
  "ranking",
  "competitor",
  "authority",
  "ai-visibility",
];

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  agent: "Agent",
  technical: "Technical",
  content: "Content",
  ranking: "Rankings",
  competitor: "Competitors",
  authority: "Authority",
  "ai-visibility": "AI visibility",
};

/** The audit trail for the selected project, newest first. */
export function buildActivity(
  project: DashboardProject,
): readonly ActivityEvent[] {
  const count = project.portfolio
    ? ACTIVITY_POOL.length
    : randInt(project.seed, 8, 10, 13);
  const selected = pickSubset(ACTIVITY_POOL, project.seed + 23, count);

  return selected.map((event, index) => ({
    id: `${project.id}-event-${index + 1}`,
    category: event.category,
    title: event.title,
    detail: event.detail,
    agent: event.agent,
    at: minutesBefore(event.age),
    state: event.state,
    project: project.name,
  }));
}
