/**
 * The run history's request and empty state (Phase 6, checkpoint 6.2). The
 * same Run History section is shown on AI Agents, where the operator picks
 * any agent, and on each agent's page, preset to that agent. Both read the
 * existing list route, `GET /api/agent-runs?project=<id>[&agent=<id>]`;
 * nothing here is a new route. Pure and client-safe.
 */

export type RunHistoryQuery = {
  readonly projectId: string;
  /** The agent to list, or empty for every agent. */
  readonly agentId: string;
  readonly limit: number;
  readonly offset: number;
};

/** The list route for one page of a project's runs, narrowed to one agent when given. */
export function runHistoryListUrl(query: RunHistoryQuery): string {
  const params = new URLSearchParams({ project: query.projectId, limit: String(query.limit), offset: String(query.offset) });
  if (query.agentId) params.set("agent", query.agentId);
  return `/api/agent-runs?${params.toString()}`;
}

/**
 * What an empty list says. On an agent's page (a preset agent) it names that
 * agent and says no run is recorded — never that the agent did nothing
 * elsewhere, and never a zero figure.
 */
export function runHistoryEmptyState(input: {
  readonly projectName: string;
  /** The preset agent's name on an agent's page; null on AI Agents. */
  readonly presetAgentName: string | null;
  /** The agent picked on AI Agents, if any. */
  readonly pickedAgentName: string | null;
}): { readonly title: string; readonly description: string } {
  if (input.presetAgentName !== null) {
    return {
      title: "No runs recorded for this agent",
      description: `No task run by ${input.presetAgentName} is recorded on ${input.projectName}. Choose another project to see its runs.`,
    };
  }
  return {
    title: "No runs yet",
    description: `No agent task has been run on ${input.projectName}${input.pickedAgentName ? ` by ${input.pickedAgentName}` : ""}.`,
  };
}
