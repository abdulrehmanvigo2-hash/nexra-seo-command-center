import { clamp, pickSubset, randInt } from "@/lib/mock/dashboard/core";
import type {
  ContentPage,
  ContentSnapshot,
  DashboardProject,
  DateRange,
} from "@/types/dashboard";

/**
 * Page-level content performance, split into the four buckets an editor works
 * from: what is winning, what is slipping, what is worth writing, and what
 * has just shipped.
 *
 * Titles, URLs, and the reason each page sits in its bucket are authored;
 * clicks, impressions, and conversions scale with the selected project and
 * window so they stay consistent with the KPI cards above.
 */

type PageSeed = Omit<
  ContentPage,
  "id" | "clicks" | "impressions" | "conversions"
> & {
  /** Clicks in a 30-day window at portfolio scale. */
  readonly baseClicks: number;
  /** Impressions per click, which varies a lot by page type. */
  readonly impressionRatio: number;
  /** Conversions per hundred clicks. */
  readonly conversionRate: number;
};

const PAGES: readonly PageSeed[] = [
  {
    title: "Business banking comparison",
    url: "/compare/business-banking",
    bucket: "top",
    ctr: 6.8,
    position: 3.4,
    trend: { value: 18.2 },
    state: "published",
    note: "Best converting page in the portfolio; holds three featured snippets.",
    baseClicks: 14_820,
    impressionRatio: 14.7,
    conversionRate: 3.1,
  },
  {
    title: "What is a merchant category code",
    url: "/learn/merchant-category-codes",
    bucket: "top",
    ctr: 9.4,
    position: 2.1,
    trend: { value: 11.6 },
    state: "published",
    note: "Top-of-funnel anchor; feeds the comparison hub through internal links.",
    baseClicks: 12_140,
    impressionRatio: 10.6,
    conversionRate: 0.8,
  },
  {
    title: "Smart thermostats for older homes",
    url: "/guides/smart-thermostats-older-homes",
    bucket: "top",
    ctr: 5.9,
    position: 4.8,
    trend: { value: 24.5 },
    state: "published",
    note: "Gained four positions after the refresh; now outranks two rivals.",
    baseClicks: 9_460,
    impressionRatio: 16.9,
    conversionRate: 2.2,
  },
  {
    title: "TMS vs ERP for logistics teams",
    url: "/compare/tms-vs-erp",
    bucket: "top",
    ctr: 7.2,
    position: 3.9,
    trend: { value: 9.1 },
    state: "published",
    note: "Highest assisted-conversion contribution of any comparison page.",
    baseClicks: 7_320,
    impressionRatio: 13.8,
    conversionRate: 4.4,
  },
  {
    title: "Onboarding guide for new accounts",
    url: "/guides/account-onboarding",
    bucket: "declining",
    ctr: 2.4,
    position: 11.6,
    trend: { value: -34.2 },
    state: "decaying",
    note: "Statistics are two years old and the SERP now favours step formats.",
    baseClicks: 4_180,
    impressionRatio: 41.2,
    conversionRate: 1.9,
  },
  {
    title: "Underfloor heating vs radiators",
    url: "/guides/underfloor-heating-vs-radiators",
    bucket: "declining",
    ctr: 1.8,
    position: 24.1,
    trend: { value: -28.7 },
    state: "decaying",
    note: "Lost nine positions after a competitor published a deeper guide.",
    baseClicks: 2_940,
    impressionRatio: 52.6,
    conversionRate: 1.1,
  },
  {
    title: "Health screening packages compared",
    url: "/services/health-screening",
    bucket: "declining",
    ctr: 2.1,
    position: 22.4,
    trend: { value: -21.4 },
    state: "needs-refresh",
    note: "Pricing table is out of date, which is suppressing click-through.",
    baseClicks: 2_260,
    impressionRatio: 38.9,
    conversionRate: 2.8,
  },
  {
    title: "Camping stove fuel types explained",
    url: "/guides/camping-stove-fuel",
    bucket: "declining",
    ctr: 1.2,
    position: 34.2,
    trend: { value: -17.8 },
    state: "needs-refresh",
    note: "Thin against the current top ten; needs comparison tables and images.",
    baseClicks: 1_180,
    impressionRatio: 61.4,
    conversionRate: 0.6,
  },
  {
    title: "SME lending rates, 2026 edition",
    url: "/lending/rates",
    bucket: "opportunity",
    ctr: 1.6,
    position: 11.2,
    trend: { value: 4.2 },
    state: "needs-refresh",
    note: "Ranks eleventh with strong impressions; a title rewrite should reach page one.",
    baseClicks: 3_420,
    impressionRatio: 44.8,
    conversionRate: 3.6,
  },
  {
    title: "Last-mile delivery tracking software",
    url: "/platform/last-mile",
    bucket: "opportunity",
    ctr: 2.2,
    position: 18.4,
    trend: { value: -6.4 },
    state: "needs-refresh",
    note: "High commercial intent but no comparison section; rivals all have one.",
    baseClicks: 2_780,
    impressionRatio: 36.1,
    conversionRate: 4.9,
  },
  {
    title: "Waterproof hiking boots buying guide",
    url: "/guides/waterproof-hiking-boots",
    bucket: "opportunity",
    ctr: 1.9,
    position: 19.6,
    trend: { value: 7.8 },
    state: "planned",
    note: "Brief approved and researched; no page published against it yet.",
    baseClicks: 1_640,
    impressionRatio: 47.3,
    conversionRate: 2.4,
  },
  {
    title: "Freight audit timeline explained",
    url: "/resources/freight-audit-timeline",
    bucket: "opportunity",
    ctr: 3.1,
    position: 12.4,
    trend: { value: 12.9 },
    state: "published",
    note: "Rising steadily; adding an answer block should make it AI-eligible.",
    baseClicks: 2_120,
    impressionRatio: 29.6,
    conversionRate: 1.7,
  },
  {
    title: "Three-season tent buying guide",
    url: "/guides/three-season-tents",
    bucket: "recent",
    ctr: 4.4,
    position: 9.8,
    trend: { value: 46.1 },
    state: "published",
    note: "Published 11 days ago; already ranking on page one.",
    baseClicks: 1_920,
    impressionRatio: 22.4,
    conversionRate: 2.1,
  },
  {
    title: "Same-day appointment booking",
    url: "/book/same-day",
    bucket: "recent",
    ctr: 5.2,
    position: 16.8,
    trend: { value: 38.4 },
    state: "published",
    note: "Published 18 days ago; climbed eleven positions since launch.",
    baseClicks: 1_460,
    impressionRatio: 19.8,
    conversionRate: 6.2,
  },
  {
    title: "Energy efficient home upgrades",
    url: "/guides/energy-efficient-upgrades",
    bucket: "recent",
    ctr: 3.6,
    position: 13.2,
    trend: { value: 29.7 },
    state: "published",
    note: "Published 24 days ago as the hub for the retrofit cluster.",
    baseClicks: 2_380,
    impressionRatio: 27.1,
    conversionRate: 1.4,
  },
  {
    title: "Private GP consultation costs",
    url: "/services/gp-consultation",
    bucket: "recent",
    ctr: 4.8,
    position: 8.4,
    trend: { value: 33.2 },
    state: "published",
    note: "Published 27 days ago; already the strongest commercial page in its cluster.",
    baseClicks: 2_640,
    impressionRatio: 20.6,
    conversionRate: 5.1,
  },
];

export function buildContentSnapshot(
  project: DashboardProject,
  range: DateRange,
): ContentSnapshot {
  // Non-portfolio projects get a share of the traffic, lifted so a small
  // project still shows meaningful page-level numbers rather than single digits.
  const scale = project.portfolio ? 1 : project.scale * 2.1;
  const windowScale = range.days / 30;

  const selected = project.portfolio
    ? PAGES
    : pickSubset(PAGES, project.seed + 29, randInt(project.seed, 30, 11, 14));

  const pages: readonly ContentPage[] = selected.map((page, index) => {
    const clicks = Math.max(
      12,
      Math.round(page.baseClicks * scale * windowScale ** 0.92),
    );

    return {
      id: `${project.id}-page-${index + 1}`,
      title: page.title,
      url: page.url,
      bucket: page.bucket,
      clicks,
      impressions: Math.round(clicks * page.impressionRatio),
      ctr: page.ctr,
      position: page.position,
      conversions: Math.max(0, Math.round((clicks * page.conversionRate) / 100)),
      trend: page.trend,
      state: page.state,
      note: page.note,
    };
  });

  const decayAlerts = pages.filter((page) => page.state === "decaying").length;
  const needsRefresh = pages.filter((page) => page.state === "needs-refresh").length;

  return {
    pages,
    decayAlerts: decayAlerts + randInt(project.seed, 31, 1, 5),
    needsRefresh: needsRefresh + randInt(project.seed, 32, 2, 9),
    publishedInWindow: Math.max(
      1,
      Math.round(clamp(9 * scale, 1, 40) * windowScale ** 0.8),
    ),
    opportunities: randInt(project.seed, 33, 12, 74),
  };
}
