import { healthOf } from "@/lib/health";
import { formatCompact, formatNumber } from "@/lib/format";
import type { ProjectListItem, ProjectMetric } from "@/types/project";

/**
 * Portfolio figures derived from roster rows.
 *
 * Pure and fixture-free: it reads only the rows it is given, which is why the
 * Projects screen can run it on the client over the canonical roster plus any
 * projects created in the session.
 */

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

function sum(values: readonly number[]): number {
  return values.reduce((carry, value) => carry + value, 0);
}

/**
 * The eight portfolio numbers above the roster.
 *
 * Derived from the rows on screen, not from a separate fixture — filtering the
 * roster is a display concern, so these always describe the full portfolio and
 * say so.
 */
export function getPortfolioMetrics(
  items: readonly ProjectListItem[],
): readonly ProjectMetric[] {
  const active = items.filter((item) => item.status === "active");
  const attention = items.filter(
    (item) => item.status === "needs-attention" || item.criticalIssues > 0,
  );
  const averageHealth = Math.round(mean(items.map((item) => item.health)));
  const averageAi = Math.round(mean(items.map((item) => item.aiVisibility)));
  const openIssues = sum(items.map((item) => item.openIssues));
  const criticalIssues = sum(items.map((item) => item.criticalIssues));

  return [
    {
      id: "total-projects",
      label: "Total projects",
      value: formatNumber(items.length),
      detail: `${items.filter((item) => item.draft).length} added this session`,
      icon: "projects",
    },
    {
      id: "active-projects",
      label: "Active projects",
      value: formatNumber(active.length),
      detail: `${items.length - active.length} in another state`,
      icon: "bolt",
      health: "positive",
    },
    {
      id: "needs-attention",
      label: "Needs attention",
      value: formatNumber(attention.length),
      detail: `${criticalIssues} critical issues across the portfolio`,
      icon: "alert",
      health: attention.length > 0 ? "warning" : "positive",
    },
    {
      id: "average-health",
      label: "Average SEO health",
      value: String(averageHealth),
      unit: "/ 100",
      detail: "Mean of every project's health index",
      icon: "shield",
      health: healthOf(averageHealth),
    },
    {
      id: "total-traffic",
      label: "Total organic traffic",
      value: formatCompact(sum(items.map((item) => item.organicTraffic))),
      unit: "sessions",
      detail: "Last 30 days, all projects",
      icon: "analytics",
    },
    {
      id: "total-keywords",
      label: "Total ranking keywords",
      value: formatCompact(sum(items.map((item) => item.rankingKeywords))),
      detail: "Tracked across every project",
      icon: "keywords",
    },
    {
      id: "open-issues",
      label: "Total open issues",
      value: formatNumber(openIssues),
      detail: `${criticalIssues} critical, ${openIssues - criticalIssues} other`,
      icon: "flag",
      health: criticalIssues > 0 ? "warning" : "neutral",
    },
    {
      id: "average-ai",
      label: "Average AI visibility",
      value: String(averageAi),
      unit: "/ 100",
      detail: "Presence across tracked answer engines",
      icon: "sparkles",
      health: healthOf(averageAi),
    },
  ];
}
