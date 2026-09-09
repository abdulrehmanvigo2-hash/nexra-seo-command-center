import { formatNumber, formatPercent } from "@/lib/format";
import {
  clamp,
  deltaFor,
  minutesBefore,
  randInt,
  round,
  scoreFor,
  volumeFor,
} from "@/lib/mock/dashboard/core";
import type {
  CheckStatus,
  CoreWebVital,
  DashboardProject,
  DateRange,
  TechnicalCheck,
  TechnicalSnapshot,
} from "@/types/dashboard";

/**
 * Compact site-health view: the ten checks a technical lead scans first, plus
 * Core Web Vitals.
 *
 * Counts scale with the size of the project and with how healthy it is, so a
 * project carrying a negative health offset shows more defects across the
 * board rather than one arbitrary number moving.
 */

/** Grades a defect count against thresholds relative to the site's size. */
function gradeCount(count: number, scale: number): CheckStatus {
  const warn = Math.max(3, Math.round(28 * scale));
  const critical = Math.max(12, Math.round(120 * scale));
  if (count >= critical) return "critical";
  if (count >= warn) return "warning";
  return "healthy";
}

export function buildTechnicalSnapshot(
  project: DashboardProject,
  range: DateRange,
): TechnicalSnapshot {
  const scale = project.portfolio ? 1 : project.scale * 2.4;
  // A weaker project carries proportionally more defects.
  const defectFactor = clamp(1 - project.healthOffset / 22, 0.45, 2.1);

  const crawledPages = volumeFor(project, 148_600, 41);

  const defect = (index: number, base: number) =>
    Math.max(
      0,
      Math.round(base * scale * defectFactor * (0.7 + randInt(project.seed, index, 0, 60) / 100)),
    );

  const crawlErrors = defect(51, 46);
  const brokenLinks = defect(52, 118);
  const redirectIssues = defect(53, 205);
  const duplicateContent = defect(54, 74);
  const missingMetadata = defect(55, 162);
  const schemaIssues = defect(56, 96);

  const indexability = round(clamp(94.2 + project.healthOffset * 0.3, 58, 99.6), 1);
  const vitalsPass = round(clamp(78 + project.healthOffset * 0.9, 24, 99), 0);

  const sitemapHealthy = indexability > 88;
  const robotsHealthy = crawlErrors < Math.max(20, 90 * scale);

  const checks: readonly TechnicalCheck[] = [
    {
      id: "crawl-errors",
      label: "Crawl errors",
      value: formatNumber(crawlErrors),
      status: gradeCount(crawlErrors, scale),
      detail: "URLs returning 4xx or 5xx during the last crawl",
    },
    {
      id: "broken-links",
      label: "Broken links",
      value: formatNumber(brokenLinks),
      status: gradeCount(brokenLinks, scale * 1.8),
      detail: "Internal links pointing at URLs that no longer resolve",
    },
    {
      id: "redirect-issues",
      label: "Redirect issues",
      value: formatNumber(redirectIssues),
      status: gradeCount(redirectIssues, scale * 3),
      detail: "Chains and loops costing crawl budget and link equity",
    },
    {
      id: "core-web-vitals",
      label: "Core Web Vitals",
      value: `${vitalsPass}% passing`,
      status: vitalsPass >= 85 ? "healthy" : vitalsPass >= 65 ? "warning" : "critical",
      detail: "Share of URLs meeting all three field thresholds",
    },
    {
      id: "indexability",
      label: "Indexability",
      value: formatPercent(indexability),
      status: indexability >= 92 ? "healthy" : indexability >= 80 ? "warning" : "critical",
      detail: "Crawlable URLs eligible for the index",
    },
    {
      id: "sitemap",
      label: "Sitemap status",
      value: sitemapHealthy ? "Valid" : "Stale",
      status: sitemapHealthy ? "healthy" : "warning",
      detail: sitemapHealthy
        ? "Submitted, parsed, and free of errors"
        : "Contains URLs removed from the index over a week ago",
    },
    {
      id: "robots",
      label: "Robots status",
      value: robotsHealthy ? "Valid" : "Review",
      status: robotsHealthy ? "healthy" : "warning",
      detail: robotsHealthy
        ? "No directive blocking an indexable template"
        : "A disallow rule overlaps an indexable path",
    },
    {
      id: "duplicate-content",
      label: "Duplicate content",
      value: formatNumber(duplicateContent),
      status: gradeCount(duplicateContent, scale * 1.3),
      detail: "URL clusters sharing substantially identical content",
    },
    {
      id: "missing-metadata",
      label: "Missing metadata",
      value: formatNumber(missingMetadata),
      status: gradeCount(missingMetadata, scale * 2.4),
      detail: "Pages without a title or meta description",
    },
    {
      id: "schema",
      label: "Structured data",
      value: formatNumber(schemaIssues),
      status: gradeCount(schemaIssues, scale * 1.6),
      detail: "Items failing validation or missing required fields",
    },
  ];

  const lcp = round(clamp(2.4 - project.healthOffset * 0.05, 1.1, 5.2), 1);
  const inp = Math.round(clamp(186 - project.healthOffset * 3.4, 90, 520));
  const cls = round(clamp(0.09 - project.healthOffset * 0.003, 0.01, 0.42), 2);

  const vitals: readonly CoreWebVital[] = [
    {
      id: "lcp",
      label: "LCP",
      value: `${lcp}s`,
      target: "under 2.5s",
      status: lcp <= 2.5 ? "healthy" : lcp <= 4 ? "warning" : "critical",
      passRate: round(clamp(vitalsPass + 4, 10, 100), 0),
    },
    {
      id: "inp",
      label: "INP",
      value: `${inp}ms`,
      target: "under 200ms",
      status: inp <= 200 ? "healthy" : inp <= 500 ? "warning" : "critical",
      passRate: round(clamp(vitalsPass + 9, 10, 100), 0),
    },
    {
      id: "cls",
      label: "CLS",
      value: cls.toFixed(2),
      target: "under 0.10",
      status: cls <= 0.1 ? "healthy" : cls <= 0.25 ? "warning" : "critical",
      passRate: round(clamp(vitalsPass - 3, 10, 100), 0),
    },
  ];

  return {
    score: scoreFor(project, 71, 2),
    trend: { value: deltaFor(project, range, 33, 2.6, 4.2) },
    crawledPages,
    lastCrawl: minutesBefore(randInt(project.seed, 44, 90, 900)),
    checks,
    vitals,
  };
}
