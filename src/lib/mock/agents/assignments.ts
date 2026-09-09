import { getProjectList } from "@/lib/mock/projects";
import type { AgentId } from "@/types/agent";
import type { ProjectListItem } from "@/types/project";

/**
 * Which agents are staffed on which projects.
 *
 * Read straight from the Projects roster: every project row already carries
 * the agents assigned to it, decided when the project's team is built. This
 * module only inverts that relation so it can be read the other way round —
 * "which projects does the Writer support" as well as "who is on Verdant
 * Home".
 *
 * Nothing here decides an assignment. Doing so would create a second answer to
 * a question the Projects module has already answered, and the two would drift
 * apart the first time either changed (Phase 4 scope §19).
 */

let cache: Map<AgentId, readonly ProjectListItem[]> | null = null;

function buildMap(): Map<AgentId, readonly ProjectListItem[]> {
  const map = new Map<AgentId, ProjectListItem[]>();

  for (const project of getProjectList()) {
    for (const agent of project.agents) {
      const existing = map.get(agent);
      if (existing) {
        existing.push(project);
      } else {
        map.set(agent, [project]);
      }
    }
  }

  return map;
}

/** Projects an agent is staffed on, in roster order. */
export function projectsForAgent(
  agentId: AgentId,
): readonly ProjectListItem[] {
  cache ??= buildMap();
  return cache.get(agentId) ?? [];
}

/** How many projects both agents are staffed on. */
export function sharedProjectCount(a: AgentId, b: AgentId): number {
  const first = projectsForAgent(a);
  const second = new Set(projectsForAgent(b).map((project) => project.id));
  return first.filter((project) => second.has(project.id)).length;
}
