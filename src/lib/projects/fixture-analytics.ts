import {
  PROJECTS,
  PROJECTS_AS_OF,
  buildProjectDetail,
  buildProjectListItem,
} from "@/lib/mock/projects";
import type { RangeId } from "@/types/dashboard";
import type {
  Project,
  ProjectDetail,
  ProjectListItem,
  ProjectRecord,
} from "@/types/project";

/**
 * Reporting data for stored projects, until a real source for it exists.
 *
 * This is the hybrid boundary, kept in one file on purpose. A persistent store
 * holds the project record — who the client is, what it targets, where the
 * engagement stands. It does not hold health scores, traffic, keywords, issues,
 * tasks, or the team, because nothing measures those yet. For the nine
 * canonical projects those figures are still generated from the fixture
 * roster's simulation parameters, joined here by id.
 *
 * The record always comes from the store, so a renamed project shows its new
 * name; only the numbers are simulated. A stored project with no fixture
 * counterpart has no numbers at all, and says so (see `unmeasuredListItem`).
 * When reporting data is persisted, this file is what goes.
 */

/** The instant the simulated figures describe. */
export const FIXTURE_ANALYTICS_AS_OF = PROJECTS_AS_OF;

/** A record joined with its simulation parameters, or null if it has none. */
export function withFixtureAnalytics(record: ProjectRecord): Project | null {
  const fixture = PROJECTS.find((project) => project.id === record.id);
  if (!fixture) return null;

  return {
    ...record,
    id: fixture.id,
    portfolio: false,
    scale: fixture.scale,
    healthOffset: fixture.healthOffset,
    seed: fixture.seed,
  };
}

/**
 * Where a project sits in the canonical roster, or null. Keeps the stored
 * roster in the order the fixture roster has always been read in, so rows that
 * tie under a sort appear in the same order as before.
 */
export function fixtureRosterPosition(id: string): number | null {
  const index = PROJECTS.findIndex((project) => project.id === id);
  return index === -1 ? null : index;
}

export function fixtureListItem(project: Project): ProjectListItem {
  return buildProjectListItem(project);
}

export function fixtureDetail(project: Project, rangeId: RangeId): ProjectDetail {
  return buildProjectDetail(project, rangeId);
}

/**
 * A roster row for a stored project that has no reporting data yet.
 *
 * Every figure is zero and there is no workspace link: the project exists, but
 * nothing has measured it, and the roster's card already reads "Awaiting
 * crawl" for exactly this case. It is not a session draft — it was stored.
 */
export function unmeasuredListItem(record: ProjectRecord): ProjectListItem {
  return {
    id: record.id,
    name: record.name,
    domain: record.domain,
    client: record.client,
    industry: record.industry,
    initials: record.initials,
    type: record.type,
    status: record.status,
    market: record.market,
    goal: record.goal,
    href: null,
    draft: false,
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
    updatedAt: record.updatedAt,
  };
}
