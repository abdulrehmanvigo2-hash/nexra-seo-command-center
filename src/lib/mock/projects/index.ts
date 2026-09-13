import {
  buildAgentOperations,
  buildAiVisibilitySnapshot,
  buildCompetitorSnapshot,
  buildContentSnapshot,
  buildKeywordSnapshot,
  buildScoreCards,
  buildTechnicalSnapshot,
  buildTrendSeries,
  DATA_AS_OF,
  DEFAULT_RANGE_ID,
  getRange,
  SESSION_VALUE_USD,
} from "@/lib/mock/dashboard";
import { pickSubset, randInt, round } from "@/lib/mock/dashboard/core";
import { buildProjectIssues } from "@/lib/mock/projects/issues";
import { buildProjectNotes } from "@/lib/mock/projects/notes";
import { PROJECTS, getProjectRecord } from "@/lib/mock/projects/roster";
import { buildProjectTasks } from "@/lib/mock/projects/tasks";
import {
  formatCompact,
  formatCurrencyCompact,
  formatNumber,
} from "@/lib/format";
import type { AgentOperation, DateRange, MetricHealth, RangeId } from "@/types/dashboard";
import type {
  AssignedAgent,
  Project,
  ProjectDetail,
  ProjectListItem,
  ProjectMetric,
  ProjectStatus,
} from "@/types/project";

/**
 * Single entry point for the Projects module's mock data.
 *
 * Screens take project records from the project repository
 * (`@/lib/projects/repository`), not from here; its mock implementation is the
 * only screen-facing reader of the getters below. What screens still import
 * from this file is display vocabulary — status and type labels, option lists
 * — which is not project data. The other modules' fixture generators read the
 * roster and getters directly, because they are mock data built from it.
 * Everything returned is a fixture — there is no API, database, or fetching
 * layer in this milestone (CLAUDE.md §4).
 *
 * A project's health, trend, keywords, content, and technical data come from
 * the Command Center's own builders rather than from a second derivation.
 * That is deliberate: selecting a project on the dashboard and opening its
 * workspace here must show the same numbers, because they are the same
 * numbers.
 */

export {
  PROJECTS,
  PORTFOLIO_PROJECT,
  getProjectRecord,
} from "@/lib/mock/projects/roster";

export {
  INDUSTRY_OPTIONS,
  ISSUE_KIND_META,
  ISSUE_KIND_ORDER,
  ISSUE_STATUS_CYCLE,
  ISSUE_STATUS_META,
  LANGUAGE_OPTIONS,
  MARKET_OPTIONS,
  PROJECT_GOAL_META,
  PROJECT_GOAL_ORDER,
  PROJECT_STATUS_META,
  PROJECT_STATUS_ORDER,
  PROJECT_TYPE_META,
  PROJECT_TYPE_ORDER,
  TASK_DUE_META,
  TASK_STATUS_META,
  TASK_STATUS_ORDER,
} from "@/lib/mock/projects/meta";

export { buildProjectIssues } from "@/lib/mock/projects/issues";
export { buildProjectTasks } from "@/lib/mock/projects/tasks";
export { buildProjectNotes } from "@/lib/mock/projects/notes";

/** The instant every project fixture is written against. */
export const PROJECTS_AS_OF = DATA_AS_OF;

/** Window the roster's numbers are measured over. */
const ROSTER_RANGE = getRange("30d");

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

/**
 * The agents assigned to a project.
 *
 * Not all twelve: an agency does not staff a small local engagement the way it
 * staffs an enterprise account. The Director and the Project Manager are on
 * every project because they own strategy and delivery; the rest of the team
 * is a reproducible subset sized by how much project there is.
 *
 * A paused engagement has nobody working: every assigned agent is waiting.
 */
function buildTeam(
  project: Project,
  range: DateRange,
  status: ProjectStatus,
): readonly AssignedAgent[] {
  const roster = buildAgentOperations(project, range);
  const core = roster.filter((agent) => agent.stage <= 2);
  const rest = roster.filter((agent) => agent.stage > 2);

  const specialists = pickSubset(
    rest,
    project.seed + 733,
    randInt(project.seed + 17, 2, 4, 8),
  );

  const team = [...core, ...specialists].sort((a, b) => a.stage - b.stage);

  if (status !== "paused") return team;
  return team.map(holdingPattern);
}

/**
 * An agent on a paused engagement.
 *
 * The rule lives here because the engagement's state is the Projects module's
 * to know, and it is exported because the Agents module has to apply the same
 * one: an agent shown as blocked on a project the client has paused would
 * contradict the project's own team panel.
 */
export function holdingPattern(agent: AgentOperation): AgentOperation {
  return {
    ...agent,
    status: "waiting",
    progress: 0,
    attention: false,
    currentTask: "Holding — the engagement is paused at the client's request.",
  };
}

// ---------------------------------------------------------------------------
// Roster rows
// ---------------------------------------------------------------------------

/** One roster row for a project record. Exported for stores that supply their own records. */
export function buildProjectListItem(project: Project): ProjectListItem {
  const range = ROSTER_RANGE;
  const trend = buildTrendSeries(project, range);
  const keywords = buildKeywordSnapshot(project, range, trend);
  const scores = buildScoreCards(project, range);
  const technical = buildTechnicalSnapshot(project, range);
  const ai = buildAiVisibilitySnapshot(project, range);
  const issues = buildProjectIssues(project, project.status);
  const tasks = buildProjectTasks(project, project.status);
  const team = buildTeam(project, range, project.status);

  const overall = scores.find((score) => score.id === "seo-health") ?? scores[0];
  const open = issues.filter((issue) => issue.status !== "resolved");

  return {
    id: project.id,
    name: project.name,
    domain: project.domain,
    client: project.client,
    industry: project.industry,
    initials: project.initials,
    type: project.type,
    status: project.status,
    market: project.market,
    goal: project.goal,
    href: `/projects/${project.id}`,
    draft: false,
    health: overall.score,
    healthState: overall.health,
    technicalHealth: technical.score,
    visibility: round(trend.totals.searchVisibility, 1),
    aiVisibility: ai.score,
    organicTraffic: trend.totals.organicTraffic,
    trafficTrend: { value: trend.deltas.organicTraffic },
    rankingKeywords: keywords.tracked,
    conversions: trend.totals.conversions,
    openIssues: open.length,
    criticalIssues: open.filter((issue) => issue.kind === "critical").length,
    activeTasks: tasks.filter((task) => task.status !== "completed").length,
    agents: team.map((agent) => agent.agent),
    spark: trend.current.map((point) => point.organicTraffic),
    updatedAt: project.updatedAt,
  };
}

/**
 * The roster.
 *
 * Built once and cached: every row derives a full trend series, and the
 * Projects page re-renders on every keystroke of its search field. The
 * builders are pure, so the cached result is the only result they could
 * produce.
 */
let rosterCache: readonly ProjectListItem[] | null = null;

export function getProjectList(): readonly ProjectListItem[] {
  rosterCache ??= PROJECTS.map(buildProjectListItem);
  return rosterCache;
}

/** Ids of every project with a workspace — used to prerender their routes. */
export function getProjectIds(): readonly string[] {
  return PROJECTS.map((project) => project.id);
}

// ---------------------------------------------------------------------------
// Project workspace
// ---------------------------------------------------------------------------

function trendHealth(value: number, invert = false): MetricHealth {
  const good = invert ? -value : value;
  if (good > 1.5) return "positive";
  if (good < -4) return "negative";
  if (good < -1) return "warning";
  return "neutral";
}

/** The performance numbers on a project workspace, for the selected window. */
function buildProjectMetrics(
  project: Project,
  range: DateRange,
  trend: ReturnType<typeof buildTrendSeries>,
  keywords: ReturnType<typeof buildKeywordSnapshot>,
): readonly ProjectMetric[] {
  const conversionsLabel =
    project.goal === "leads" || project.type === "lead-gen"
      ? "Leads"
      : "Conversions";

  return [
    {
      id: "organic-traffic",
      label: "Organic traffic",
      value: formatCompact(trend.totals.organicTraffic),
      unit: "sessions",
      detail: range.comparison,
      icon: "analytics",
      trend: { value: trend.deltas.organicTraffic },
      health: trendHealth(trend.deltas.organicTraffic),
    },
    {
      id: "organic-keywords",
      label: "Organic keywords",
      value: formatCompact(keywords.tracked),
      unit: "ranking",
      detail: range.comparison,
      icon: "keywords",
      trend: { value: trend.deltas.organicKeywords },
      health: trendHealth(trend.deltas.organicKeywords),
    },
    {
      id: "search-visibility",
      label: "Search visibility",
      value: round(trend.totals.searchVisibility, 1).toFixed(1),
      unit: "/ 100",
      detail: "Share of voice across the tracked set",
      icon: "target",
      trend: { value: trend.deltas.searchVisibility },
      health: trendHealth(trend.deltas.searchVisibility),
    },
    {
      id: "conversions",
      label: conversionsLabel,
      value: formatNumber(trend.totals.conversions),
      unit: conversionsLabel.toLowerCase(),
      detail: range.comparison,
      icon: "flag",
      trend: { value: trend.deltas.conversions },
      health: trendHealth(trend.deltas.conversions),
    },
    {
      id: "traffic-value",
      label: "Traffic value",
      value: formatCurrencyCompact(
        trend.totals.organicTraffic * SESSION_VALUE_USD,
      ),
      detail: `Priced at $${SESSION_VALUE_USD.toFixed(2)} per session`,
      icon: "value",
      trend: { value: trend.deltas.organicTraffic },
      health: trendHealth(trend.deltas.organicTraffic),
    },
    {
      id: "average-position",
      label: "Average position",
      value: keywords.movement.averagePosition.toFixed(1),
      detail: "Across every tracked keyword",
      icon: "gauge",
      trend: keywords.movement.averagePositionTrend,
      health: trendHealth(keywords.movement.averagePositionTrend.value, true),
    },
  ];
}

/**
 * Everything one project workspace renders, over one window.
 *
 * Returns null for an unknown id so the route can render a not-found page
 * rather than inventing a project.
 */
export function getProjectDetail(
  projectId: string,
  rangeId: RangeId = DEFAULT_RANGE_ID,
): ProjectDetail | null {
  const project = getProjectRecord(projectId);
  return project ? buildProjectDetail(project, rangeId) : null;
}

/** The workspace for a project record. Exported for stores that supply their own records. */
export function buildProjectDetail(
  project: Project,
  rangeId: RangeId = DEFAULT_RANGE_ID,
): ProjectDetail {
  const range = getRange(rangeId);
  const trend = buildTrendSeries(project, range);
  const keywords = buildKeywordSnapshot(project, range, trend);
  const competitors = buildCompetitorSnapshot(project, range, trend);

  return {
    project,
    range,
    generatedAt: DATA_AS_OF,
    health: buildScoreCards(project, range),
    metrics: buildProjectMetrics(project, range, trend, keywords),
    trend,
    issues: buildProjectIssues(project, project.status),
    tasks: buildProjectTasks(project, project.status),
    team: buildTeam(project, range, project.status),
    keywords,
    content: buildContentSnapshot(project, range),
    technical: buildTechnicalSnapshot(project, range),
    competitors: competitors.rivals,
    contentGaps: competitors.gapOpportunities,
    sharedKeywords: competitors.sharedKeywords,
    notes: buildProjectNotes(project),
  };
}
