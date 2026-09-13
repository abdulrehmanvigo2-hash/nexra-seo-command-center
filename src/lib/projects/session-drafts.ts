import { initialsOf, normaliseDomain } from "@/lib/projects/intake-rules";
import type { NewProjectInput, ProjectListItem } from "@/types/project";

/**
 * Projects created in the intake flow during this session.
 *
 * Deliberately separate from the project repository. A draft is held in the
 * Projects screen's own state and is gone on reload: nothing here writes to a
 * store, and the repository has no write method, because there is nowhere to
 * write to yet. When there is, creation becomes a repository concern and this
 * module is where the session-only version is retired.
 */

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
