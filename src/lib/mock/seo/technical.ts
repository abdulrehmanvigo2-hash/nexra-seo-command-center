import type { TechnicalIssue } from "@/types/seo";

/**
 * Site-health defects across the portfolio, most severe first.
 *
 * Demo fixtures — a representative sample of the backlog summarised by the
 * "Critical Issues" metric in `overview.ts`, not the full list.
 */
export const TECHNICAL_ISSUES: readonly TechnicalIssue[] = [
  {
    id: "issue-01",
    issue: "Noindex rule left in place after the template migration",
    severity: "critical",
    affectedPages: 1840,
    category: "indexation",
    status: "in-progress",
    project: "Verdant Home",
  },
  {
    id: "issue-02",
    issue: "Duplicate canonical tags on paginated archives",
    severity: "critical",
    affectedPages: 612,
    category: "crawlability",
    status: "in-progress",
    project: "Skyline Outdoors",
  },
  {
    id: "issue-03",
    issue: "Largest Contentful Paint above 4s on mobile product pages",
    severity: "critical",
    affectedPages: 284,
    category: "performance",
    status: "investigating",
    project: "Halcyon Fintech",
  },
  {
    id: "issue-04",
    issue: "Mixed-content requests blocking secure page loads",
    severity: "high",
    affectedPages: 96,
    category: "security",
    status: "open",
    project: "Meridian Clinics",
  },
  {
    id: "issue-05",
    issue: "Product schema missing required price and availability fields",
    severity: "high",
    affectedPages: 1204,
    category: "structured-data",
    status: "open",
    project: "Skyline Outdoors",
  },
  {
    id: "issue-06",
    issue: "Crawl budget consumed by faceted filter URLs",
    severity: "high",
    affectedPages: 7420,
    category: "crawlability",
    status: "investigating",
    project: "Verdant Home",
  },
  {
    id: "issue-07",
    issue: "Viewport not set on the legacy help-centre templates",
    severity: "medium",
    affectedPages: 318,
    category: "mobile",
    status: "open",
    project: "Orbit Logistics",
  },
  {
    id: "issue-08",
    issue: "Thin service pages under 150 words",
    severity: "medium",
    affectedPages: 74,
    category: "content",
    status: "monitoring",
    project: "Meridian Clinics",
  },
  {
    id: "issue-09",
    issue: "Redirect chains three hops deep from the old category paths",
    severity: "medium",
    affectedPages: 205,
    category: "crawlability",
    status: "monitoring",
    project: "Halcyon Fintech",
  },
  {
    id: "issue-10",
    issue: "Cumulative Layout Shift above threshold on blog templates",
    severity: "low",
    affectedPages: 431,
    category: "performance",
    status: "resolved",
    project: "Orbit Logistics",
  },
];
