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
  NewProjectInput,
  Project,
  ProjectDetail,
  ProjectListItem,
  ProjectMetric,
  ProjectStatus,
} from "@/types/project";

/**
 * Single entry point for the Projects module's mock data.
 *
 * Import from `@/lib/mock/projects` and the shapes from `@/types/project`; the
 * files behind this one are implementation detail. Everything returned is a
 * fixture — there is no API, database, or fetching layer in this milestone
 * (CLAUDE.md §4).
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

  return team.map(
    (agent): AgentOperation => ({
      ...agent,
      status: "waiting",
      progress: 0,
      attention: false,
      currentTask: "Holding — the engagement is paused at the client's request.",
    }),
  );
}

// ---------------------------------------------------------------------------
// Roster rows
// ---------------------------------------------------------------------------

function buildListItem(project: Project): ProjectListItem {
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
  rosterCache ??= PROJECTS.map(buildListItem);
  return rosterCache;
}

/** Ids of every project with a workspace — used to prerender their routes. */
export function getProjectIds(): readonly string[] {
  return PROJECTS.map((project) => project.id);
}

// ---------------------------------------------------------------------------
// Portfolio metrics
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

function sum(values: readonly number[]): number {
  return values.reduce((carry, value) => carry + value, 0);
}

function healthOf(score: number): MetricHealth {
  if (score >= 75) return "positive";
  if (score >= 60) return "neutral";
  if (score >= 45) return "warning";
  return "negative";
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
  if (!project) return null;

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

// ---------------------------------------------------------------------------
// Projects created in this session
// ---------------------------------------------------------------------------

/** Two-letter monogram from a project name. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "NP";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Strips the scheme and any trailing slash, leaving the bare host and path. */
export function normaliseDomain(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/**
 * A roster row for a project created in this session.
 *
 * Every metric is zero, and that is the honest answer: the project has just
 * been created, no crawl has run, and inventing a health score for it would be
 * a lie the rest of the page would then repeat. It carries no `href` for the
 * same reason — there is no workspace to open until there is data in it.
 */
export function buildDraftListItem(
  input: NewProjectInput,
  createdAt: string,
): ProjectListItem {
  const domain = normaliseDomain(input.url);

  return {
    id: `draft-${domain || input.name.toLowerCase().replace(/\s+/g, "-")}`,
    name: input.name.trim(),
    domain,
    client: input.client.trim(),
    industry: input.industry,
    initials: initialsOf(input.name),
    type: input.type,
    status: "onboarding",
    market: input.market,
    goal: input.goal,
    href: null,
    draft: true,
    health: 0,
    healthState: "neutral",
    technicalHealth: 0,
    visibility: 0,
    aiVisibility: 0,
    organicTraffic: 0,
    trafficTrend: { value: 0 },
    rankingKeywords: 0,
    conversions: 0,
    openIssues: 0,
    criticalIssues: 0,
    activeTasks: 0,
    agents: ["project-manager", "seo-director"],
    spark: [],
    updatedAt: createdAt,
  };
}
