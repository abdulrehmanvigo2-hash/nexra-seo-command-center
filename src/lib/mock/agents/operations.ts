import { buildAgentOperations } from "@/lib/mock/dashboard/agents";
import { getRange } from "@/lib/mock/dashboard/core";
import { holdingPattern } from "@/lib/mock/projects";
import { PROJECTS } from "@/lib/mock/projects/roster";
import { projectsForAgent } from "@/lib/mock/agents/assignments";
import type { AgentOperation } from "@/types/dashboard";
import type { AgentId } from "@/types/agent";

/**
 * What every agent is doing, on every project.
 *
 * One place, because three parts of this module need the same answer: the
 * roster rolls it up per agent, the orchestration pipeline reads it per stage,
 * and an agent's assignments list reads it per project. Calling the builder
 * separately in each of them would be three chances to forget the engagement
 * rules below.
 *
 * The call itself is the Command Center's own: selecting a project there and
 * opening this module show the same agent in the same state, because it is the
 * same record. The one adjustment is the Projects module's paused rule, which
 * is imported rather than repeated.
 */

/** Window the module's numbers are measured over. */
export const AGENT_RANGE = getRange("30d");

let cache: Map<string, Map<AgentId, AgentOperation>> | null = null;

export function operationsByProject(): Map<string, Map<AgentId, AgentOperation>> {
  cache ??= new Map(
    PROJECTS.map((project) => [
      project.id,
      new Map(
        buildAgentOperations(project, AGENT_RANGE).map((operation) => {
          // A paused engagement has nobody working on it. Without this, an
          // agent would read as blocked here while the project's own team
          // panel — which applies the rule — showed it waiting.
          const resolved =
            project.status === "paused" ? holdingPattern(operation) : operation;
          return [resolved.agent, resolved];
        }),
      ),
    ]),
  );
  return cache;
}

/** The agent's state on one project, if it is staffed on it. */
export function operationFor(
  projectId: string,
  agentId: AgentId,
): AgentOperation | undefined {
  return operationsByProject().get(projectId)?.get(agentId);
}

/** Every project state this agent is in, in roster order. */
export function operationsFor(
  agentId: AgentId,
): readonly { readonly projectId: string; readonly operation: AgentOperation }[] {
  return projectsForAgent(agentId).flatMap((project) => {
    const operation = operationFor(project.id, agentId);
    return operation ? [{ projectId: project.id, operation }] : [];
  });
}
