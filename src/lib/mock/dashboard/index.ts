import { buildActivity, buildAlerts } from "@/lib/mock/dashboard/signals";
import { buildAgentOperations } from "@/lib/mock/dashboard/agents";
import { buildAiVisibilitySnapshot } from "@/lib/mock/dashboard/ai-visibility";
import { buildAuthoritySnapshot } from "@/lib/mock/dashboard/authority";
import { buildCompetitorSnapshot } from "@/lib/mock/dashboard/competitors";
import { buildContentSnapshot } from "@/lib/mock/dashboard/content";
import { buildKeywordSnapshot } from "@/lib/mock/dashboard/keywords";
import { buildKpiCards, buildScoreCards } from "@/lib/mock/dashboard/metrics";
import { buildPriorityActions } from "@/lib/mock/dashboard/actions";
import { buildTechnicalSnapshot } from "@/lib/mock/dashboard/technical";
import { buildTrendSeries } from "@/lib/mock/dashboard/series";
import {
  DATA_AS_OF,
  getProject,
  getRange,
} from "@/lib/mock/dashboard/core";
import type {
  DashboardSnapshot,
  ProjectId,
  RangeId,
} from "@/types/dashboard";

/**
 * Single entry point for the Command Center's mock data.
 *
 * Import `getDashboardSnapshot` from `@/lib/mock/dashboard` and the shapes
 * from `@/types/dashboard`; the domain files behind this one are
 * implementation detail. Everything returned is a fixture — there is no API,
 * database, or fetching layer in this milestone (CLAUDE.md §4).
 *
 * The function is pure and deterministic: the same project and range always
 * produce the same snapshot, on the server and in the browser alike.
 */

export {
  DASHBOARD_PROJECTS,
  DATA_AS_OF,
  DATE_RANGES,
  DEFAULT_PROJECT_ID,
  DEFAULT_RANGE_ID,
  getProject,
  getRange,
} from "@/lib/mock/dashboard/core";

export { AGENT_STATUS_META, AGENT_STATUS_ORDER } from "@/lib/mock/dashboard/agents";
export { ACTION_AREA_META } from "@/lib/mock/dashboard/actions";
export {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
} from "@/lib/mock/dashboard/signals";

/** Assembles every dataset the Command Center renders, for one selection. */
export function getDashboardSnapshot(
  projectId: ProjectId,
  rangeId: RangeId,
): DashboardSnapshot {
  const project = getProject(projectId);
  const range = getRange(rangeId);

  // The trend series is built first: the KPI cards, the keyword distribution,
  // and the competitor comparison all read from it, which is what keeps the
  // numbers on the page consistent with one another.
  const trend = buildTrendSeries(project, range);
  const keywords = buildKeywordSnapshot(project, range, trend);

  return {
    project,
    range,
    generatedAt: DATA_AS_OF,
    scores: buildScoreCards(project, range),
    kpis: buildKpiCards(project, range, trend, keywords),
    trend,
    agents: buildAgentOperations(project, range),
    actions: buildPriorityActions(project),
    alerts: buildAlerts(project),
    technical: buildTechnicalSnapshot(project, range),
    keywords,
    content: buildContentSnapshot(project, range),
    competitors: buildCompetitorSnapshot(project, range, trend),
    authority: buildAuthoritySnapshot(project, range),
    aiVisibility: buildAiVisibilitySnapshot(project, range),
    activity: buildActivity(project),
  };
}
